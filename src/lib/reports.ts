// Shared computation: closing balances per ledger as of a date
import { supabase } from "@/integrations/supabase/client";
import {
  readLedgers,
  readVoucherEntriesForCompany,
  readVouchers,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export interface LedgerBalance {
  id: string;
  name: string;
  type: string;
  group_code: string | null;
  closing_paise: number; // signed: +Dr, -Cr
}

export interface LedgerBalanceOptions {
  excludeProfitLossClosingTransfers?: boolean;
}

export interface LedgerBalanceResult {
  balances: LedgerBalance[];
  excludedClosingTransferEntries: number;
}

type VoucherEntryForBalance = {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: {
    voucher_type: string | null;
    narration: string | null;
  } | null;
};

type LedgerForBalance = {
  id: string;
  name: string;
  type: string;
  group_code: string | null;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
};

export function isProfitLossClosingTransfer(voucher: {
  voucher_type?: string | null;
  narration?: string | null;
} | null): boolean {
  if (!voucher || voucher.voucher_type !== "journal") return false;
  const text = (voucher.narration ?? "").toLowerCase();
  return (
    /profit\s*&\s*loss/.test(text) ||
    /profit\s+and\s+loss/.test(text) ||
    /net\s+profit\s+transferred/.test(text) ||
    /net\s+loss\s+transferred/.test(text) ||
    /income\s*&\s*expenditure/.test(text) ||
    /income\s+and\s+expenditure/.test(text)
  );
}

export async function fetchLedgerBalances(
  companyId: string,
  asOf: string,
  fromOpt?: string,
  options: LedgerBalanceOptions = {},
): Promise<LedgerBalance[]> {
  const result = await fetchLedgerBalancesWithMeta(companyId, asOf, fromOpt, options);
  return result.balances;
}

export async function fetchLedgerBalancesWithMeta(
  companyId: string,
  asOf: string,
  fromOpt?: string,
  options: LedgerBalanceOptions = {},
): Promise<LedgerBalanceResult> {
  const { ledgers, entries } = await withCacheFallback(
    async () => {
      const { data: ledgers, error: lErr } = await supabase
        .from("ledgers")
        .select("id, name, type, group_code, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", companyId);
      if (lErr) throw lErr;

      // Fix: Bundle the date configurations safely into a consolidated modifier object
      let queryBuilder = supabase
        .from("voucher_entries")
        .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id, voucher_type, narration)")
        .eq("vouchers.company_id", companyId);

      // Apply sequential evaluation constraints without breaking structural execution paths
      if (fromOpt) {
        queryBuilder = queryBuilder.filter("vouchers.voucher_date", "gte", fromOpt);
      }
      queryBuilder = queryBuilder.filter("vouchers.voucher_date", "lte", asOf);

      const { data: entries, error: eErr } = await queryBuilder;
      if (eErr) throw eErr;
      return {
        ledgers: (ledgers ?? []) as unknown as LedgerForBalance[],
        entries: (entries ?? []) as unknown as VoucherEntryForBalance[],
      };
    },
    async () => {
      const [ledgers, vouchers, rawEntries] = await Promise.all([
        readLedgers(companyId),
        readVouchers(companyId),
        readVoucherEntriesForCompany(companyId),
      ]);
      const voucherById = new Map(vouchers.map((v: any) => [String(v.id), v]));
      const entries = (rawEntries as any[])
        .map((e) => {
          const v = voucherById.get(String(e.voucher_id));
          if (!v) return null;
          const date = String(v.voucher_date ?? v.date ?? "");
          if (fromOpt && date < fromOpt) return null;
          if (asOf && date > asOf) return null;
          return {
            ledger_id: String(e.ledger_id ?? ""),
            debit_paise: Number(e.debit_paise ?? 0),
            credit_paise: Number(e.credit_paise ?? 0),
            vouchers: {
              voucher_type: v.voucher_type ?? null,
              narration: v.narration ?? null,
            },
          } as VoucherEntryForBalance;
        })
        .filter(Boolean) as VoucherEntryForBalance[];
      return {
        ledgers: (ledgers as any[]).map((l) => ({
          id: String(l.id),
          name: String(l.name ?? ""),
          type: String(l.type ?? ""),
          group_code: l.group_code ?? null,
          opening_balance_paise: Number(l.opening_balance_paise ?? 0),
          opening_balance_is_debit: Boolean(l.opening_balance_is_debit),
        })) as LedgerForBalance[],
        entries,
      };
    },
  );

  const movements = new Map<string, number>();
  let excludedClosingTransferEntries = 0;
  for (const e of entries) {
    if (
      options.excludeProfitLossClosingTransfers &&
      isProfitLossClosingTransfer(e.vouchers)
    ) {
      excludedClosingTransferEntries++;
      continue;
    }
    movements.set(e.ledger_id, (movements.get(e.ledger_id) || 0) + e.debit_paise - e.credit_paise);
  }

  const balances = (ledgers || []).map((l) => {
    const ob = fromOpt ? 0 : (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
    const closing = ob + (movements.get(l.id) || 0);
    return { id: l.id, name: l.name, type: l.type, group_code: l.group_code ?? null, closing_paise: closing };
  });

  return { balances, excludedClosingTransferEntries };
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
