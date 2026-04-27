// Shared computation: closing balances per ledger as of a date
import { supabase } from "@/integrations/supabase/client";

export interface LedgerBalance {
  id: string;
  name: string;
  type: string;
  group_code: string | null;
  closing_paise: number; // signed: +Dr, -Cr
}

export async function fetchLedgerBalances(
  companyId: string,
  asOf: string,
  fromOpt?: string,
): Promise<LedgerBalance[]> {
  const { data: ledgers } = await supabase
    .from("ledgers")
    .select("id, name, type, group_code, opening_balance_paise, opening_balance_is_debit")
    .eq("company_id", companyId);

  let q = supabase
    .from("voucher_entries")
    .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
    .eq("vouchers.company_id", companyId)
    .lte("vouchers.voucher_date", asOf);
  if (fromOpt) q = q.gte("vouchers.voucher_date", fromOpt);
  const { data: entries } = await q;

  const movements = new Map<string, number>();
  for (const e of (entries || []) as { ledger_id: string; debit_paise: number; credit_paise: number }[]) {
    movements.set(e.ledger_id, (movements.get(e.ledger_id) || 0) + e.debit_paise - e.credit_paise);
  }

  return (ledgers || []).map((l) => {
    const ob = fromOpt ? 0 : (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
    const closing = ob + (movements.get(l.id) || 0);
    return { id: l.id, name: l.name, type: l.type, group_code: l.group_code ?? null, closing_paise: closing };
  });
}

// Type buckets for P&L and Balance Sheet (sign: +Dr / -Cr balance natural)
export const PL_INCOME = new Set(["income_direct", "income_indirect"]);
export const PL_EXPENSE = new Set(["expense_direct", "expense_indirect"]);
export const BS_ASSET = new Set(["sundry_debtor", "cash", "bank", "fixed_asset", "current_asset", "stock_in_hand"]);
export const BS_LIAB = new Set([
  "sundry_creditor",
  "current_liability",
  "loan_liability",
  "capital",
  "duties_taxes",
]);
