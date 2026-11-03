// Period and financial-year locks in this PC's books (cache_period_locks).
// The frozen-row guard reads the same table, so a lock here blocks edits to
// vouchers in the locked dates on this PC. Locks made here stay on this PC.
import { offlineDb } from "./db";
import { newId } from "@/lib/utils/sys-utils";
import { invalidatePeriodLockCache } from "./frozen-guard";
import { logActivity } from "@/lib/activity-log";
import type { PeriodLock, ReturnType } from "@/lib/period-locks";

const LOCKED_BY = "This PC";

function toLock(r: any): PeriodLock {
  return {
    id: String(r.id),
    company_id: String(r.company_id ?? ""),
    return_type: r.return_type as ReturnType,
    period: String(r.period ?? ""),
    period_start: String(r.period_start ?? ""),
    period_end: String(r.period_end ?? ""),
    locked_at: String(r.locked_at ?? r.updated_at ?? ""),
    locked_by: String(r.locked_by ?? LOCKED_BY),
    filed_reference: r.filed_reference ?? null,
    notes: r.notes ?? null,
    is_active: r.is_active !== false,
  };
}

export async function listLocksLocal(companyId: string): Promise<PeriodLock[]> {
  const rows = (await offlineDb.cache_period_locks.where("company_id").equals(companyId).toArray()) as any[];
  return rows
    .filter((r) => r.is_deleted !== true)
    .map(toLock)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

export async function findActiveLockLocal(
  companyId: string,
  returnType: ReturnType | string,
  period: string,
): Promise<PeriodLock | null> {
  const rows = await listLocksLocal(companyId);
  return rows.find((r) => r.is_active && r.return_type === returnType && r.period === period) ?? null;
}

export async function isDateLockedLocal(companyId: string, isoDate: string): Promise<PeriodLock | null> {
  const rows = await listLocksLocal(companyId);
  return rows.find((r) => r.is_active && r.period_start <= isoDate && isoDate <= r.period_end) ?? null;
}

/** Locks a period. Locking an already locked period returns the existing lock. */
export async function lockPeriodLocal(args: {
  companyId: string;
  returnType: ReturnType | string;
  period: string;
  periodStart: string;
  periodEnd: string;
  filedReference?: string | null;
  notes?: string | null;
}): Promise<string> {
  const existing = await findActiveLockLocal(args.companyId, args.returnType, args.period);
  if (existing) return existing.id;
  const id = newId();
  const now = new Date().toISOString();
  await offlineDb.cache_period_locks.put({
    id,
    company_id: args.companyId,
    return_type: args.returnType,
    period: args.period,
    period_start: args.periodStart,
    period_end: args.periodEnd,
    locked_at: now,
    locked_by: LOCKED_BY,
    filed_reference: args.filedReference ?? null,
    notes: args.notes ?? null,
    is_active: true,
    is_synced: false,
    is_deleted: false,
    updated_at: now,
  });
  invalidatePeriodLockCache();
  void logActivity({
    company_id: args.companyId,
    entity_type: "settings",
    entity_id: id,
    entity_label: `Period lock: ${args.returnType} ${args.period}`,
    action: "create",
    note: args.filedReference ? `Filed ref: ${args.filedReference}` : (args.notes ?? null),
  });
  return id;
}

/** Unlocks a period. A reason of at least 10 characters is required. */
export async function unlockPeriodLocal(args: {
  companyId: string;
  returnType: ReturnType | string;
  period: string;
  reason: string;
}): Promise<void> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new Error("Please type a reason of at least 10 characters to unlock a filed period.");
  }
  const existing = await findActiveLockLocal(args.companyId, args.returnType, args.period);
  if (!existing) throw new Error("This period is not locked.");
  await offlineDb.cache_period_locks.update(existing.id, {
    is_active: false,
    is_synced: false,
    updated_at: new Date().toISOString(),
  });
  invalidatePeriodLockCache();
  void logActivity({
    company_id: args.companyId,
    entity_type: "settings",
    entity_id: existing.id,
    entity_label: `Period unlock: ${args.returnType} ${args.period}`,
    action: "delete",
    note: reason,
  });
}
