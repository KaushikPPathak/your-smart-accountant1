// Period locks (GSTR-1 / GSTR-3B filed months). Locks live in this PC's books, so
// they work offline and in local-only mode. The frozen-row guard reads the same
// records, which blocks edits to vouchers inside a locked period.
import {
  listLocksLocal,
  findActiveLockLocal,
  isDateLockedLocal,
  lockPeriodLocal,
  unlockPeriodLocal,
} from "@/lib/offline/period-locks-local";
import { listActivity } from "@/lib/activity-log";

export type ReturnType = "GSTR1" | "GSTR3B";

export interface PeriodLock {
  id: string;
  company_id: string;
  return_type: ReturnType;
  period: string;
  period_start: string;
  period_end: string;
  locked_at: string;
  locked_by: string;
  filed_reference: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface PeriodLockAudit {
  id: string;
  company_id: string;
  period_lock_id: string | null;
  return_type: string;
  period: string;
  action: "lock" | "unlock" | "relock";
  reason: string;
  performed_by: string;
  performed_at: string;
}

export async function fetchLocks(companyId: string): Promise<PeriodLock[]> {
  return listLocksLocal(companyId);
}

export async function fetchLockFor(
  companyId: string,
  returnType: ReturnType,
  period: string,
): Promise<PeriodLock | null> {
  return findActiveLockLocal(companyId, returnType, period);
}

/**
 * Check whether a given calendar date is inside any active lock for this company.
 * Used by voucher forms to disable Save / show a banner.
 */
export async function isDateLocked(companyId: string, isoDate: string): Promise<PeriodLock | null> {
  return isDateLockedLocal(companyId, isoDate);
}

export async function lockPeriod(args: {
  companyId: string;
  returnType: ReturnType;
  period: string;
  periodStart: string;
  periodEnd: string;
  filedReference?: string;
  notes?: string;
}): Promise<string> {
  return lockPeriodLocal(args);
}

export async function unlockPeriod(args: {
  companyId: string;
  returnType: ReturnType;
  period: string;
  reason: string;
}): Promise<void> {
  return unlockPeriodLocal(args);
}

/**
 * History of locks and unlocks, read from this PC's activity log.
 */
export async function fetchAudit(companyId: string, limit = 50): Promise<PeriodLockAudit[]> {
  const rows = await listActivity(companyId, { limit: limit * 4 });
  return rows
    .filter((r) => r.entity_type === "settings" && /^Period (lock|unlock):/.test(r.entity_label ?? ""))
    .slice(0, limit)
    .map((r, i) => {
      const label = String(r.entity_label ?? "");
      const isUnlock = label.startsWith("Period unlock:");
      const rest = label.replace(/^Period (lock|unlock): /, "").split(" ");
      return {
        id: String(r.id ?? `${r.ts}-${i}`),
        company_id: r.company_id,
        period_lock_id: r.entity_id ?? null,
        return_type: rest[0] ?? "",
        period: rest.slice(1).join(" "),
        action: isUnlock ? "unlock" : "lock",
        reason: String(r.note ?? ""),
        performed_by: r.actor ?? "This PC",
        performed_at: new Date(r.ts).toISOString(),
      };
    });
}

/** Friendly message for lock errors so toasts read well. */
export function isPeriodLockError(err: unknown): boolean {
  const m = (err as { message?: string } | null)?.message ?? "";
  return m.toLowerCase().includes("period is locked");
}
