// Frozen-row guard.
//
// A row is "frozen" when no automated repair, normalizer, invariant sweep,
// or cache rebuild is allowed to modify or delete it. Freeze conditions:
//
//   - Voucher whose date falls inside an ACTIVE period lock
//     (GSTR1 / GSTR3B filed period).
//   - Voucher (or any row) that has a pending outbox entry — rewriting
//     it would clobber the user's unsynced edit on next drain.
//   - Any audit-log row (period_lock_audit, voucher_repair_audit).
//
// This module is the single source of truth. If ever we add another
// automated writer, it MUST route through `isVoucherFrozen()` /
// `hasPendingOutbox()` before touching a row.

import { offlineDb } from "./db";

export interface FrozenReason {
  frozen: true;
  reason: "period-lock" | "outbox-pending" | "audit-log";
  detail?: string;
}
export interface NotFrozen { frozen: false }
export type FrozenCheck = FrozenReason | NotFrozen;

/** Tables that are audit logs — never touched by any automation. */
export const AUDIT_LOG_TABLES = new Set<string>([
  "period_lock_audit",
  "voucher_repair_audit",
  "cache_period_lock_audit",
  "cache_voucher_repair_audit",
]);

let outboxCache: { at: number; ids: Set<string> } | null = null;
const OUTBOX_TTL_MS = 5_000;

async function loadOutboxIds(): Promise<Set<string>> {
  const now = Date.now();
  if (outboxCache && now - outboxCache.at < OUTBOX_TTL_MS) return outboxCache.ids;
  const ids = new Set<string>();
  try {
    const rows: any[] = await offlineDb.outbox.toArray();
    for (const r of rows) {
      const target = r?.target_id ?? r?.record_id ?? r?.row_id ?? r?.id;
      if (target != null) ids.add(String(target));
      const vId = r?.voucher_id ?? r?.payload?.id;
      if (vId != null) ids.add(String(vId));
    }
  } catch { /* ignore */ }
  outboxCache = { at: now, ids };
  return ids;
}

/** Invalidate the outbox cache — call after outbox writes if you need fresh reads. */
export function invalidateFrozenCache(): void { outboxCache = null; }

let lockCache: { at: number; byCompany: Map<string, Array<{ start: string; end: string }>> } | null = null;
const LOCK_TTL_MS = 15_000;

async function loadPeriodLocks(): Promise<Map<string, Array<{ start: string; end: string }>>> {
  const now = Date.now();
  if (lockCache && now - lockCache.at < LOCK_TTL_MS) return lockCache.byCompany;
  const byCompany = new Map<string, Array<{ start: string; end: string }>>();
  try {
    const rows: any[] = await offlineDb.cache_period_locks.toArray();
    for (const r of rows) {
      if (r?.is_active === false) continue;
      const c = String(r?.company_id ?? "");
      const s = String(r?.period_start ?? "");
      const e = String(r?.period_end ?? "");
      if (!c || !s || !e) continue;
      const arr = byCompany.get(c) ?? [];
      arr.push({ start: s, end: e });
      byCompany.set(c, arr);
    }
  } catch { /* ignore */ }
  lockCache = { at: now, byCompany };
  return byCompany;
}

/** True when the row has any pending outbox entry (matched by id). */
export async function hasPendingOutbox(rowId: string | null | undefined): Promise<boolean> {
  if (!rowId) return false;
  const ids = await loadOutboxIds();
  return ids.has(String(rowId));
}

/** True when `isoDate` (YYYY-MM-DD) falls inside any active period lock for the company. */
export async function isDateInLockedPeriod(
  companyId: string,
  isoDate: string | null | undefined,
): Promise<boolean> {
  if (!companyId || !isoDate) return false;
  const d = isoDate.slice(0, 10);
  const locks = (await loadPeriodLocks()).get(companyId) ?? [];
  return locks.some((l) => d >= l.start && d <= l.end);
}

/** Comprehensive check for a voucher row. */
export async function isVoucherFrozen(voucher: {
  id?: string;
  company_id?: string;
  voucher_date?: string;
  date?: string;
} | null | undefined): Promise<FrozenCheck> {
  if (!voucher) return { frozen: false };
  if (await hasPendingOutbox(voucher.id)) {
    return { frozen: true, reason: "outbox-pending", detail: String(voucher.id ?? "") };
  }
  const date = voucher.voucher_date ?? voucher.date;
  if (voucher.company_id && date && (await isDateInLockedPeriod(voucher.company_id, date))) {
    return { frozen: true, reason: "period-lock", detail: date.slice(0, 10) };
  }
  return { frozen: false };
}

/** Cheap sync check for audit-log tables. Never mutate these. */
export function isAuditLogTable(tableName: string): boolean {
  return AUDIT_LOG_TABLES.has(tableName);
}
