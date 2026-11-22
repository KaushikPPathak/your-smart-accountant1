// Company-level policy thresholds (5.4 count variance, 6.5 round-off and advance notice).
//
// Source of truth: the `policy_thresholds` column on the company record in the cloud. The desktop
// SQLite row and the Dexie company cache mirror it; neither is ever edited on its own. A device
// that cannot read a usable blob uses the defaults and shows a banner. It never substitutes
// numbers silently, because two devices must not disagree on what counts as a problem.
import { offlineDb } from "@/lib/offline/db";

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

/** Count variance needs a reason when it exceeds the higher of the floor or the rate of the line value. */
export function countVarianceNeedsReason(varianceAbsPaise: number, lineValuePaise: number, policy: PolicySettings): boolean {
  const rateLimit = Math.round((Math.abs(lineValuePaise) * policy.countVarianceRateBps) / 10_000);
  return Math.abs(varianceAbsPaise) > Math.max(policy.countVarianceFloorPaise, rateLimit);
}

// ---------------------------------------------------------------------------
// Editor: the form values, validation and caps. The company save path is the only writer.
// ---------------------------------------------------------------------------

/**
 * Caps are not legal limits. They stop a typo (₹1,00,000 for ₹1,000) from silently disabling a
 * control. Raise a cap here, deliberately, if a company genuinely needs more.
 */
export const POLICY_CAPS = {
  stockAbsPaise: 200_000_00,   // ₹2,00,000 count-variance floor
  roundOffPaise: 10_00,        // ₹10 round-off absorbed automatically
  advancePaise: 10_000_00,     // ₹10,000 advance notice floor
} as const;

export interface PolicyFormValues {
  stockAbsRupees: string;
  stockPct: string;     // a fraction, 0 to 1 (0.01 = 1%)
  roundOffRupees: string;
  advanceRupees: string;
}

export function policyToForm(p: PolicySettings): PolicyFormValues {
  return {
    stockAbsRupees: String(p.countVarianceFloorPaise / 100),
    stockPct: String(p.countVarianceRateBps / 10_000),
    roundOffRupees: String(p.roundOffAutoPaise / 100),
    advanceRupees: String(p.advanceNoticePaise / 100),
  };
}

export type PolicyFormErrors = Partial<Record<keyof PolicyFormValues, string>>;

function nonNegativeNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Validate the editor values. Ok only when every field is in range and under its cap. */
export function policyFromForm(v: PolicyFormValues): { ok: true; policy: PolicySettings } | { ok: false; errors: PolicyFormErrors } {
  const errors: PolicyFormErrors = {};

  const stockAbs = nonNegativeNumber(v.stockAbsRupees);
  if (stockAbs === null) errors.stockAbsRupees = "Enter an amount of zero or more.";
  else if (Math.round(stockAbs * 100) > POLICY_CAPS.stockAbsPaise) errors.stockAbsRupees = "Above the ₹2,00,000 cap. Check for a typo.";

  const pct = nonNegativeNumber(v.stockPct);
  if (pct === null || pct > 1) errors.stockPct = "Enter a fraction from 0 to 1 (for example 0.01 for 1%).";

  const roundOff = nonNegativeNumber(v.roundOffRupees);
  if (roundOff === null) errors.roundOffRupees = "Enter an amount of zero or more.";
  else if (Math.round(roundOff * 100) > POLICY_CAPS.roundOffPaise) errors.roundOffRupees = "Above the ₹10 cap. Round-off above ₹10 is flagged for review, not absorbed.";

  const advance = nonNegativeNumber(v.advanceRupees);
  if (advance === null) errors.advanceRupees = "Enter an amount of zero or more.";
  else if (Math.round(advance * 100) > POLICY_CAPS.advancePaise) errors.advanceRupees = "Above the ₹10,000 cap. Check for a typo.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    policy: {
      countVarianceFloorPaise: Math.round((stockAbs as number) * 100),
      countVarianceRateBps: Math.round((pct as number) * 10_000),
      roundOffAutoPaise: Math.round((roundOff as number) * 100),
      advanceNoticePaise: Math.round((advance as number) * 100),
    },
  };
}

/** Where the values on screen came from, for the one line under the editor. */
export function policySourceLine(status: PolicyStatus): string {
  if (status.synced) return "Current values come from the company record.";
  if (status.reason === "missing") return "Defaults are in use: this company record has no thresholds yet.";
  if (status.reason === "newer_version") return "Defaults are in use: the stored thresholds use a newer format. Update the app.";
  return "Defaults are in use: the stored thresholds could not be read.";
}
