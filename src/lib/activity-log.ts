// Lightweight, opt-in activity log for NCE bookkeeping transparency.
//
// Local-only by design (Core rule: business data never leaves the device).
// Writes to Dexie table `activity_log`. Retention is enforced on write —
// entries older than the configured window are pruned so the table stays
// small. The log is deliberately mutable and non-cryptographic: it is a
// helpful trail for the proprietor, not a Companies-Act-grade audit block.

import { offlineDb } from "./offline/db";

export type ActivityEntityType = "voucher" | "ledger" | "item" | "company" | "settings";
export type ActivityAction = "create" | "update" | "delete";

export interface ActivityRow {
  id?: number;
  company_id: string;
  ts: number;                    // ms since epoch
  actor: string | null;          // staff / account name (best effort)
  entity_type: ActivityEntityType;
  entity_id: string | null;
  entity_label: string | null;   // e.g. voucher number, ledger name
  action: ActivityAction;
  note?: string | null;
  diff?: Record<string, unknown> | null;
}

const SETTING_KEY = "ym_activity_log_enabled";
const RETENTION_KEY = "ym_activity_log_retention_days";

export function isActivityLogEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window.localStorage.getItem(SETTING_KEY) ?? "true") === "true";
}

export function setActivityLogEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTING_KEY, on ? "true" : "false");
}

export function getActivityRetentionDays(): number {
  if (typeof window === "undefined") return 90;
  const raw = window.localStorage.getItem(RETENTION_KEY);
  const n = raw ? parseInt(raw, 10) : 90;
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function setActivityRetentionDays(days: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RETENTION_KEY, String(Math.max(7, Math.min(3650, Math.round(days)))));
}

function currentActor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const name = window.localStorage.getItem("ym_active_staff_name")
      || window.localStorage.getItem("ym_active_account_name");
    return name || null;
  } catch { return null; }
}

export async function logActivity(row: Omit<ActivityRow, "id" | "ts" | "actor"> & { actor?: string | null }): Promise<void> {
  if (!isActivityLogEnabled()) return;
  try {
    const table = (offlineDb as unknown as { activity_log?: { add: (r: ActivityRow) => Promise<number> } }).activity_log;
    if (!table) return;
    await table.add({
      ...row,
      ts: Date.now(),
      actor: row.actor ?? currentActor(),
    });
    // Best-effort background prune (fire-and-forget).
    void pruneOldActivity();
  } catch {
    /* non-fatal — logging must never break a save */
  }
}

export async function pruneOldActivity(): Promise<number> {
  try {
    const cutoff = Date.now() - getActivityRetentionDays() * 86_400_000;
    const table = (offlineDb as unknown as {
      activity_log?: { where: (k: string) => { below: (v: number) => { delete: () => Promise<number> } } };
    }).activity_log;
    if (!table) return 0;
    return await table.where("ts").below(cutoff).delete();
  } catch { return 0; }
}

export async function listActivity(companyId: string, opts: { fromTs?: number; toTs?: number; limit?: number } = {}): Promise<ActivityRow[]> {
  try {
    const table = (offlineDb as unknown as {
      activity_log?: {
        where: (k: string) => { equals: (v: string) => { reverse: () => { sortBy: (k: string) => Promise<ActivityRow[]> } } };
      };
    }).activity_log;
    if (!table) return [];
    const rows = await table.where("company_id").equals(companyId).reverse().sortBy("ts");
    let out = rows;
    if (opts.fromTs) out = out.filter((r) => r.ts >= opts.fromTs!);
    if (opts.toTs) out = out.filter((r) => r.ts <= opts.toTs!);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  } catch { return []; }
}
