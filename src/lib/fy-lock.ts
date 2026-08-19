import { supabase } from "@/integrations/supabase/client";
import { isLocalOnlyMode } from "./local-only-mode";

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
  if (isLocalOnlyMode()) {
    return syncOpeningBalancesLocally(companyId, fyStart);
  }
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

async function syncOpeningBalancesLocally(
  companyId: string,
  fyStart: string
): Promise<SyncResult> {
  const { offlineDb: db } = await import("./offline/db");
  const { readLedgers, readItems, readVoucherEntriesForCompany, readVoucherItemsForCompany } = await import("./offline/cache-read");
  const { upsertCachedLedger, upsertCachedItem } = await import("./masters-cache");

  const fy = fyRangeFromStart(fyStart);
  const prevFyEnd = new Date(new Date(fy.start).getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [ledgers, items, entries, moves] = await Promise.all([
    readLedgers(companyId),
    readItems(companyId),
    readVoucherEntriesForCompany(companyId),
    readVoucherItemsForCompany(companyId)
  ]);

  const result: SyncResult = {
    ledgers_updated: 0,
    items_updated: 0,
    ledger_details: [],
    item_details: [],
    fy_start: fyStart
  };

  const PL_TYPES = new Set(["expense_direct", "expense_indirect", "income_direct", "income_indirect"]);

  // 1. Sync Ledgers
  const ledgerMovement = new Map<string, number>();
  for (const e of entries as any[]) {
    if (e.vouchers?.voucher_date && e.vouchers.voucher_date <= prevFyEnd) {
      ledgerMovement.set(e.ledger_id, (ledgerMovement.get(e.ledger_id) ?? 0) + (e.debit_paise || 0) - (e.credit_paise || 0));
    }
  }

  for (const l of ledgers as any[]) {
    if (PL_TYPES.has(l.type)) continue;

    const op = (l.opening_balance_is_debit ? 1 : -1) * (l.opening_balance_paise || 0);
    const closing = op + (ledgerMovement.get(l.id) ?? 0);
    const newOpAbs = Math.abs(closing);
    const newOpIsDr = closing >= 0;

    if (l.opening_balance_paise !== newOpAbs || l.opening_balance_is_debit !== newOpIsDr) {
      result.ledger_details.push({
        ledger_id: l.id,
        name: l.name,
        old_paise: l.opening_balance_paise,
        old_is_debit: l.opening_balance_is_debit,
        new_paise: newOpAbs,
        new_is_debit: newOpIsDr
      });
      
      const now = new Date().toISOString();
      await db.cache_ledgers.update(l.id, {
        opening_balance_paise: newOpAbs,
        opening_balance_is_debit: newOpIsDr,
        updated_at: now,
        is_synced: false
      });
      upsertCachedLedger({ ...l, opening_balance_paise: newOpAbs, opening_balance_is_debit: newOpIsDr });
      result.ledgers_updated++;
    }
  }

  // 2. Sync Items
  const itemMovement = new Map<string, { qty: number; rate: number }>();
  const isIn = (t: string) => t === "purchase" || t === "credit_note";
  const isOut = (t: string) => t === "sales" || t === "debit_note";
  const isMfg = (t: string) => t === "manufacturing";

  for (const m of moves as any[]) {
    if (m.vouchers?.voucher_date && m.vouchers.voucher_date <= prevFyEnd) {
      const cur = itemMovement.get(m.item_id) ?? { qty: 0, rate: 0 };
      const t = m.vouchers.voucher_type;
      const v = Number(m.qty || 0);
      let nextQty = cur.qty;
      let nextRate = cur.rate;

      if (isMfg(t)) {
        nextQty += v;
        if (v > 0 && m.rate_paise) nextRate = m.rate_paise;
      } else if (isIn(t)) {
        nextQty += Math.abs(v);
        if (m.rate_paise) nextRate = m.rate_paise;
      } else if (isOut(t)) {
        nextQty -= Math.abs(v);
      }
      itemMovement.set(m.item_id, { qty: nextQty, rate: nextRate });
    }
  }

  for (const it of items as any[]) {
    const mov = itemMovement.get(it.id) ?? { qty: 0, rate: 0 };
    const closingQty = (Number(it.opening_stock_qty) || 0) + mov.qty;
    const closingRate = mov.rate || it.opening_stock_rate_paise || it.purchase_price_paise || 0;

    if (it.opening_stock_qty !== closingQty || it.opening_stock_rate_paise !== closingRate) {
      result.item_details.push({
        item_id: it.id,
        name: it.name,
        old_qty: it.opening_stock_qty,
        old_rate_paise: it.opening_stock_rate_paise,
        new_qty: closingQty,
        new_rate_paise: closingRate
      });
      
      const now = new Date().toISOString();
      await db.cache_items.update(it.id, {
        opening_stock_qty: closingQty,
        opening_stock_rate_paise: closingRate,
        updated_at: now,
        is_synced: false
      });
      upsertCachedItem({ ...it, opening_stock_qty: closingQty, opening_stock_rate_paise: closingRate });
      result.items_updated++;
    }
  }

  return result;
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
