// Company-level policy thresholds (5.4 count variance, 6.5 round-off and advance notice).
//
// Source of truth: the `policy_thresholds` column on the company record in the cloud. The desktop
// SQLite row and the Dexie company cache mirror it; neither is ever edited on its own. A device
// that cannot read a usable blob uses the defaults and shows a banner. It never substitutes
// numbers silently, because two devices must not disagree on what counts as a problem.
import { supabase } from "@/integrations/supabase/client";
import { offlineDb } from "@/lib/offline/db";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

export interface PolicySettings {
  /** 5.4: physical count variance warning floor, paise (₹500). */
  countVarianceFloorPaise: number;
  /** 5.4: physical count variance warning as a share of the line value, basis points (1%). */
  countVarianceRateBps: number;
  /** 6.5: round-off up to this many paise per invoice is absorbed automatically (₹1). */
  roundOffAutoPaise: number;
  /** 6.5: service advances at or above this amount show the GST-on-advance banner, paise (₹1,000). */
  advanceNoticePaise: number;
}

export const DEFAULT_POLICY: PolicySettings = {
  countVarianceFloorPaise: 50_000,
  countVarianceRateBps: 100,
  roundOffAutoPaise: 100,
  advanceNoticePaise: 100_000,
};

export const POLICY_VERSION = 1 as const;

/** The stored shape. Keys carry their unit so a reader never has to guess. */
export interface PolicyBlobV1 {
  v: 1;
  stockAbsPaise: number;
  stockBps: number;
  roundOffPaise: number;
  advancePaise: number;
}

export function policyBlob(p: PolicySettings): PolicyBlobV1 {
  return {
    v: POLICY_VERSION,
    stockAbsPaise: p.countVarianceFloorPaise,
    stockBps: p.countVarianceRateBps,
    roundOffPaise: p.roundOffAutoPaise,
    advancePaise: p.advanceNoticePaise,
  };
}

export type PolicyStatus =
  | { synced: true }
  | { synced: false; reason: "missing" | "newer_version" | "invalid" };

/** Read a stored blob. Anything missing, unreadable, or not understood gives the defaults plus a reason. */
export function readPolicyBlob(raw: unknown): { policy: PolicySettings; status: PolicyStatus } {
  const notSynced = (reason: "missing" | "newer_version" | "invalid") =>
    ({ policy: { ...DEFAULT_POLICY }, status: { synced: false, reason } as PolicyStatus });

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return notSynced("invalid"); }
  }
  if (obj == null) return notSynced("missing");
  if (typeof obj !== "object") return notSynced("invalid");

  const o = obj as Record<string, unknown>;
  if (typeof o.v !== "number") return notSynced("invalid");
  if (o.v > POLICY_VERSION) return notSynced("newer_version");
  if (o.v !== POLICY_VERSION) return notSynced("invalid"); // older shapes: no migration defined yet

  const fields = [o.stockAbsPaise, o.stockBps, o.roundOffPaise, o.advancePaise];
  if (!fields.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return notSynced("invalid");

  return {
    policy: {
      countVarianceFloorPaise: o.stockAbsPaise as number,
      countVarianceRateBps: o.stockBps as number,
      roundOffAutoPaise: o.roundOffPaise as number,
      advanceNoticePaise: o.advancePaise as number,
    },
    status: { synced: true },
  };
}

/** The policy for a company as this device knows it, with whether it came from the company record. */
export async function loadPolicyStatus(companyId: string): Promise<{ policy: PolicySettings; status: PolicyStatus }> {
  try {
    const row = (await offlineDb.cache_companies.get(companyId)) as { policy_thresholds?: unknown } | undefined;
    return readPolicyBlob(row?.policy_thresholds);
  } catch {
    return readPolicyBlob(undefined);
  }
}

export async function loadPolicy(companyId: string): Promise<PolicySettings> {
  return (await loadPolicyStatus(companyId)).policy;
}

/**
 * Save thresholds to the company record. There is no offline override: if the cloud write fails,
 * nothing changes locally and the user is told to try again when connected. Local-only companies
 * have no cloud record, so their local mirror is the record.
 */
export async function savePolicy(companyId: string, next: PolicySettings): Promise<void> {
  const blob = policyBlob(next);
  if (!isLocalOnlyMode()) {
    const { error } = await supabase.from("companies").update({ policy_thresholds: blob }).eq("id", companyId);
    if (error) throw new Error(`Thresholds not saved (${error.message}). Connect and try again.`);
  }
  await mirrorPolicy(companyId, blob);
}

/**
 * Called when company rows arrive from the cloud: refresh the desktop SQLite mirror from each row's
 * blob. The company record stays the only source; this never writes a value that did not come from it.
 */
export async function mirrorPolicyFromRecords(rows: { id: string; policy_thresholds?: unknown }[]): Promise<void> {
  const { isTauri, getDb } = await import("@/utils/nativeDb");
  if (!isTauri()) return;
  const db = await getDb();
  for (const r of rows) {
    if (r.policy_thresholds == null) continue;
    await db
      .execute("UPDATE companies SET policy_thresholds = $1 WHERE id = $2", [JSON.stringify(r.policy_thresholds), r.id])
      .catch(() => undefined);
  }
}

/** Write the mirrors: the Dexie company cache and, on desktop, the SQLite company row. */
async function mirrorPolicy(companyId: string, blob: PolicyBlobV1): Promise<void> {
  await offlineDb.cache_companies.update(companyId, { policy_thresholds: blob });
  const { isTauri, getDb } = await import("@/utils/nativeDb");
  if (isTauri()) {
    const db = await getDb();
    await db.execute("UPDATE companies SET policy_thresholds = $1 WHERE id = $2", [JSON.stringify(blob), companyId]);
  }
}

/** Count variance needs a reason when it exceeds the higher of the floor or the rate of the line value. */
export function countVarianceNeedsReason(varianceAbsPaise: number, lineValuePaise: number, policy: PolicySettings): boolean {
  const rateLimit = Math.round((Math.abs(lineValuePaise) * policy.countVarianceRateBps) / 10_000);
  return Math.abs(varianceAbsPaise) > Math.max(policy.countVarianceFloorPaise, rateLimit);
}
