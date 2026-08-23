// Shared computation: closing balances per ledger as of a date
import { supabase } from "@/integrations/supabase/client";
import { readAccountingDataset, withCacheFallback, } from "@/lib/offline/cache-read";
export function isProfitLossClosingTransfer(voucher) {
    if (!voucher || voucher.voucher_type !== "journal")
        return false;
    const text = (voucher.narration ?? "").toLowerCase();
    return (/profit\s*&\s*loss/.test(text) ||
        /profit\s+and\s+loss/.test(text) ||
        /net\s+profit\s+transferred/.test(text) ||
        /net\s+loss\s+transferred/.test(text) ||
        /income\s*&\s*expenditure/.test(text) ||
        /income\s+and\s+expenditure/.test(text));
}
export async function fetchLedgerBalances(companyId, asOf, fromOpt, options = {}) {
    const result = await fetchLedgerBalancesWithMeta(companyId, asOf, fromOpt, options);
    return result.balances;
}
export async function fetchLedgerBalancesWithMeta(companyId, asOf, fromOpt, options = {}) {
    const { ledgers, entries } = await withCacheFallback(async () => {
        const { data: ledgers, error: lErr } = await supabase
            .from("ledgers")
            .select("id, name, type, group_code, opening_balance_paise, opening_balance_is_debit")
            .eq("company_id", companyId);
        if (lErr)
            throw lErr;
        let queryBuilder = supabase
            .from("voucher_entries")
            .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id, voucher_type, narration)")
            .eq("vouchers.company_id", companyId);
        if (fromOpt) {
            queryBuilder = queryBuilder.filter("vouchers.voucher_date", "gte", fromOpt);
        }
        queryBuilder = queryBuilder.filter("vouchers.voucher_date", "lte", asOf);
        const { data: entries, error: eErr } = await queryBuilder;
        if (eErr)
            throw eErr;
        return {
            ledgers: (ledgers ?? []),
            entries: (entries ?? []),
        };
    }, async () => readAccountingDataset(companyId, { from: fromOpt, to: asOf }));
    const movements = new Map();
    let excludedClosingTransferEntries = 0;
    for (const e of entries) {
        if (options.excludeProfitLossClosingTransfers &&
            isProfitLossClosingTransfer(e.vouchers)) {
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
export const BS_ASSET = new Set(["cash", "bank", "fixed_asset", "investment", "stock_in_hand", "loan_advance", "current_asset", "duties_taxes"]);
export const BS_LIAB = new Set([
    "capital",
    "reserve_surplus",
    "loan_liability",
    "sundry_creditor",
    "duties_taxes",
    "current_liability",
    "bank", // Overdrafts
]);
export async function fetchLedgerModeSplits(companyId, from, to, options = {}) {
    const { ledgers, entries } = await withCacheFallback(async () => {
        const { data: leds } = await supabase
            .from("ledgers")
            .select("id, type")
            .eq("company_id", companyId);
        const { data: ves } = await supabase
            .from("voucher_entries")
            .select("voucher_id, ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id, voucher_type, narration)")
            .eq("vouchers.company_id", companyId)
            .filter("vouchers.voucher_date", "gte", from)
            .filter("vouchers.voucher_date", "lte", to);
        return {
            ledgers: (leds ?? []),
            entries: (ves ?? []),
        };
    }, async () => {
        const { ledgers, entries } = await readAccountingDataset(companyId, { from, to });
        return {
            ledgers: ledgers.map((l) => ({ id: String(l.id), type: String(l.type ?? "") })),
            entries: entries,
        };
    });
    const typeOf = new Map(ledgers.map((l) => [l.id, l.type]));
    const byVoucher = new Map();
    for (const e of entries) {
        if (options.excludeProfitLossClosingTransfers && isProfitLossClosingTransfer(e.vouchers))
            continue;
        const arr = byVoucher.get(e.voucher_id) ?? [];
        arr.push(e);
        byVoucher.set(e.voucher_id, arr);
    }
    const out = new Map();
    const bump = (id, key, v) => {
        if (!v)
            return;
        const cur = out.get(id) ?? { cashPaise: 0, bankPaise: 0, otherPaise: 0 };
        cur[key] += v;
        out.set(id, cur);
    };
    for (const [, es] of byVoucher) {
        let cashNet = 0, bankNet = 0;
        for (const e of es) {
            const t = typeOf.get(e.ledger_id);
            const m = (e.debit_paise || 0) - (e.credit_paise || 0);
            if (t === "cash")
                cashNet += m;
            else if (t === "bank")
                bankNet += m;
        }
        const cashAbs = Math.abs(cashNet);
        const bankAbs = Math.abs(bankNet);
        const totalAbs = cashAbs + bankAbs;
        for (const e of es) {
            const t = typeOf.get(e.ledger_id);
            if (t === "cash" || t === "bank")
                continue;
            const m = (e.debit_paise || 0) - (e.credit_paise || 0);
            if (!m)
                continue;
            if (totalAbs === 0) {
                bump(e.ledger_id, "otherPaise", m);
            }
            else {
                const cashShare = Math.round((m * cashAbs) / totalAbs);
                const bankShare = m - cashShare;
                bump(e.ledger_id, "cashPaise", cashShare);
                bump(e.ledger_id, "bankPaise", bankShare);
            }
        }
    }
    return out;
}
