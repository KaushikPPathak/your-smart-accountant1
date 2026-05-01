import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await (supabase as any)
    .from("period_locks")
    .select("*")
    .eq("company_id", companyId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PeriodLock[];
}

export async function fetchLockFor(
  companyId: string,
  returnType: ReturnType,
  period: string,
): Promise<PeriodLock | null> {
  const { data, error } = await (supabase as any)
    .from("period_locks")
    .select("*")
    .eq("company_id", companyId)
    .eq("return_type", returnType)
    .eq("period", period)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PeriodLock | null;
}

/**
 * Check whether a given calendar date is inside any active lock for this company.
 * Used by voucher forms to disable Save / show a banner before the DB trigger fires.
 */
export async function isDateLocked(companyId: string, isoDate: string): Promise<PeriodLock | null> {
  const { data, error } = await (supabase as any)
    .from("period_locks")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .lte("period_start", isoDate)
    .gte("period_end", isoDate)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as PeriodLock | null;
}

export async function lockPeriod(args: {
  companyId: string;
  returnType: ReturnType;
  period: string;
  periodStart: string;
  periodEnd: string;
  filedReference?: string;
  notes?: string;
}) {
  const { data, error } = await (supabase as any).rpc("lock_period", {
    _company_id: args.companyId,
    _return_type: args.returnType,
    _period: args.period,
    _period_start: args.periodStart,
    _period_end: args.periodEnd,
    _filed_reference: args.filedReference ?? null,
    _notes: args.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function unlockPeriod(args: {
  companyId: string;
  returnType: ReturnType;
  period: string;
  reason: string;
}) {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new Error("Please type a reason of at least 10 characters to unlock a filed period.");
  }
  const { error } = await (supabase as any).rpc("unlock_period", {
    _company_id: args.companyId,
    _return_type: args.returnType,
    _period: args.period,
    _reason: reason,
  });
  if (error) throw error;
}

export async function fetchAudit(companyId: string, limit = 50): Promise<PeriodLockAudit[]> {
  const { data, error } = await (supabase as any)
    .from("period_lock_audit")
    .select("*")
    .eq("company_id", companyId)
    .order("performed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PeriodLockAudit[];
}

/** Friendly message for DB trigger errors so toasts read well. */
export function isPeriodLockError(err: unknown): boolean {
  const m = (err as { message?: string } | null)?.message ?? "";
  return m.toLowerCase().includes("period is locked");
}