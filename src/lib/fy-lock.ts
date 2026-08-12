import { supabase } from "@/integrations/supabase/client";

/**
 * Helpers for the "Provisional Balance Sync & Year-End Lock" utility.
 *
 * - FY locks reuse the existing period_locks infrastructure with
 *   return_type = 'fy_close'. The DB triggers enforce_period_lock_vouchers /
 *   enforce_period_lock_child already block all voucher CRUD whose
 *   voucher_date falls inside any active lock — no extra enforcement needed.
 * - Opening-balance sync is a single RPC that compares last-FY closing
 *   against this-FY opening for ledgers + items and overwrites drift.
 */

export const FY_LOCK_RETURN_TYPE = "fy_close";

export function fyLabelFromStart(startIso: string): string {
  const y = new Date(startIso).getFullYear();
  return `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function fyRangeFromStart(startIso: string): { start: string; end: string } {
  const y = new Date(startIso).getFullYear();
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export interface SyncLedgerDetail {
  ledger_id: string;
  name: string;
  old_paise: number;
  old_is_debit: boolean;
  new_paise: number;
  new_is_debit: boolean;
}
export interface SyncItemDetail {
  item_id: string;
  name: string;
  old_qty: number;
  old_rate_paise: number;
  new_qty: number;
  new_rate_paise: number;
}
export interface SyncResult {
  ledgers_updated: number;
  items_updated: number;
  ledger_details: SyncLedgerDetail[];
  item_details: SyncItemDetail[];
  fy_start: string;
}

export async function syncOpeningBalances(
  companyId: string,
  fyStart: string,
): Promise<SyncResult> {
  const { data, error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: SyncResult | null; error: { message: string } | null }>;
  }).rpc("sync_opening_balances_from_previous_fy", {
    _company_id: companyId,
    _fy_start: fyStart,
  });
  if (error) throw new Error(error.message);
  return (
    data ?? {
      ledgers_updated: 0,
      items_updated: 0,
      ledger_details: [],
      item_details: [],
      fy_start: fyStart,
    }
  );
}

export interface FyLockStatus {
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  notes: string | null;
}

export async function getFyLockStatus(
  companyId: string,
  fyStart: string,
): Promise<FyLockStatus> {
  const { data } = await (supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            eq: (col: string, val: unknown) => {
              eq: (col: string, val: unknown) => {
                maybeSingle: () => Promise<{ data: { locked_at: string; locked_by: string; notes: string | null } | null }>;
              };
            };
          };
        };
      };
    };
  })
    .from("period_locks")
    .select("locked_at, locked_by, notes")
    .eq("company_id", companyId)
    .eq("return_type", FY_LOCK_RETURN_TYPE)
    .eq("period", fyLabelFromStart(fyStart))
    .eq("is_active", true)
    .maybeSingle();
  return {
    locked: !!data,
    lockedAt: data?.locked_at ?? null,
    lockedBy: data?.locked_by ?? null,
    notes: data?.notes ?? null,
  };
}

export async function lockFinancialYear(args: {
  companyId: string;
  fyStart: string;
  notes?: string;
}): Promise<string> {
  const range = fyRangeFromStart(args.fyStart);
  const { data, error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>;
  }).rpc("lock_period", {
    _company_id: args.companyId,
    _return_type: FY_LOCK_RETURN_TYPE,
    _period: fyLabelFromStart(args.fyStart),
    _period_start: range.start,
    _period_end: range.end,
    _filed_reference: null,
    _notes: args.notes ?? "Financial year frozen after audit",
  });
  if (error) throw new Error(error.message);
  return data ?? "";
}

export async function unlockFinancialYear(args: {
  companyId: string;
  fyStart: string;
  reason: string;
}): Promise<void> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new Error("Please type a reason of at least 10 characters to unlock a frozen financial year.");
  }
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("unlock_period", {
    _company_id: args.companyId,
    _return_type: FY_LOCK_RETURN_TYPE,
    _period: fyLabelFromStart(args.fyStart),
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}
