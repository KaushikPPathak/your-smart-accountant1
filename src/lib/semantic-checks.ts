// Semantic post-condition checks for a company's books.
//
// Unlike ReindexAndRepostTool (which audits *structural* integrity — orphans,
// Dr=Cr, duplicates), these checks ask the harder report-level questions:
//
//   - Does Trial Balance tally? (sum of Dr balances == sum of Cr balances)
//   - Does Balance Sheet tally? (Assets == Liabilities + Capital ± P&L)
//   - If there are sales/purchase vouchers, does P&L show non-zero figures
//     (after excluding year-end closing journals)?
//   - Are there any vouchers whose entries were inserted singly (a tell-tale
//     sign of a partially-failed restore)?
//   - Are there any vouchers with zero entries (the "Day Book shows it but
//     reports are blank" pattern)?
//
// Designed to be called from:
//   - ReindexAndRepostTool — adds semantic findings to its step feed.
//   - RestoreFromFileDialog — runs immediately after restore so the user
//     gets a "Restored AND verified" confirmation, not just "Restored".

import { supabase } from "@/integrations/supabase/client";
import {
  fetchLedgerBalancesWithMeta,
  PL_INCOME, PL_EXPENSE, BS_ASSET, BS_LIAB,
} from "@/lib/reports";
import {
  readVoucherEntriesForCompany,
  readVouchers,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export type SemanticSeverity = "ok" | "warn" | "error";

export interface SemanticFinding {
  key: string;
  label: string;
  severity: SemanticSeverity;
  message: string;
}

export interface SemanticReport {
  findings: SemanticFinding[];
  hasError: boolean;
  hasWarning: boolean;
  /** Quick one-line summary for toast/snackbar. */
  summary: string;
}

const MAX_REPORTABLE_PAISE = 100; // ₹1 rounding tolerance

export async function runSemanticChecks(companyId: string): Promise<SemanticReport> {
  const findings: SemanticFinding[] = [];
  const asOf = new Date().toISOString().slice(0, 10);

  // ---- Pull voucher + entry counts in one shot --------------------------
  const { vouchers, entries } = await withCacheFallback(
    async () => {
      const [vRes, eRes] = await Promise.all([
        supabase.from("vouchers").select("id, voucher_type").eq("company_id", companyId),
        supabase
          .from("voucher_entries")
          .select("voucher_id, vouchers!inner(company_id)")
          .eq("vouchers.company_id", companyId),
      ]);
      if (vRes.error) throw vRes.error;
      if (eRes.error) throw eRes.error;
      return {
        vouchers: (vRes.data ?? []) as { id: string; voucher_type: string }[],
        entries: (eRes.data ?? []) as unknown as { voucher_id: string }[],
      };
    },
    async () => {
      const [vouchers, entries] = await Promise.all([
        readVouchers(companyId),
        readVoucherEntriesForCompany(companyId),
      ]);
      return {
        vouchers: (vouchers as any[]).map((v) => ({
          id: String(v.id),
          voucher_type: String(v.voucher_type ?? ""),
        })),
        entries: (entries as any[]).map((e) => ({ voucher_id: String(e.voucher_id ?? "") })),
      };
    },
  );

  // ---- Zero-entry vouchers (Day Book shows, reports blank) --------------
  const entryCountByVoucher = new Map<string, number>();
  for (const e of entries) {
    entryCountByVoucher.set(e.voucher_id, (entryCountByVoucher.get(e.voucher_id) ?? 0) + 1);
  }
  const zeroEntryVouchers = vouchers.filter((v) => !entryCountByVoucher.has(v.id));
  const singleEntryVouchers = vouchers.filter((v) => entryCountByVoucher.get(v.id) === 1);

  if (zeroEntryVouchers.length > 0) {
    findings.push({
      key: "zero_entry_vouchers",
      label: "Vouchers with no posting rows",
      severity: "error",
      message:
        `${zeroEntryVouchers.length} voucher(s) appear in the Day Book but have ZERO posting rows — ` +
        `reports (Balance Sheet, P&L, Trial Balance) will be blank for these. ` +
        `Usually caused by a partial restore. Re-run the restore from your latest backup file.`,
    });
  } else {
    findings.push({
      key: "zero_entry_vouchers",
      label: "Vouchers with no posting rows",
      severity: "ok",
      message: `All ${vouchers.length} vouchers have posting rows ✓`,
    });
  }

  if (singleEntryVouchers.length > 0) {
    findings.push({
      key: "single_entry_vouchers",
      label: "Vouchers with only one posting row",
      severity: "warn",
      message:
        `${singleEntryVouchers.length} voucher(s) have exactly 1 posting row. ` +
        `A valid double-entry voucher always has 2+ rows (Dr=Cr). ` +
        `Open Housekeeping → Verify Books to inspect.`,
    });
  }

  // ---- Trial Balance tally ---------------------------------------------
  const tb = await fetchLedgerBalancesWithMeta(companyId, asOf);
  let dr = 0, cr = 0;
  for (const b of tb.balances) {
    if (b.closing_paise > 0) dr += b.closing_paise;
    else cr += -b.closing_paise;
  }
  const tbDiff = Math.abs(dr - cr);
  findings.push({
    key: "tb_tally",
    label: "Trial Balance tallies (Dr = Cr)",
    severity: tbDiff <= MAX_REPORTABLE_PAISE ? "ok" : "error",
    message:
      tbDiff <= MAX_REPORTABLE_PAISE
        ? `Trial Balance tallies — Dr ₹${(dr / 100).toFixed(2)} = Cr ₹${(cr / 100).toFixed(2)} ✓`
        : `Trial Balance MISMATCH — Dr ₹${(dr / 100).toFixed(2)} vs Cr ₹${(cr / 100).toFixed(2)} ` +
          `(difference ₹${(tbDiff / 100).toFixed(2)}). This usually indicates missing voucher_entries.`,
  });

  // ---- Balance Sheet tally (Assets == Liab + Capital ± P&L) -------------
  const tbExPL = await fetchLedgerBalancesWithMeta(companyId, asOf, undefined, {
    excludeProfitLossClosingTransfers: true,
  });
  let assets = 0, liab = 0, income = 0, expense = 0;
  for (const b of tbExPL.balances) {
    if (BS_ASSET.has(b.type)) assets += b.closing_paise;
    else if (BS_LIAB.has(b.type)) liab += -b.closing_paise;
    else if (PL_INCOME.has(b.type)) income += -b.closing_paise;
    else if (PL_EXPENSE.has(b.type)) expense += b.closing_paise;
  }
  const profit = income - expense;
  const bsDiff = Math.abs(assets - (liab + profit));
  findings.push({
    key: "bs_tally",
    label: "Balance Sheet tallies",
    severity: bsDiff <= MAX_REPORTABLE_PAISE ? "ok" : "warn",
    message:
      bsDiff <= MAX_REPORTABLE_PAISE
        ? `Balance Sheet tallies — Assets ₹${(assets / 100).toFixed(2)} = Liab+Capital+P&L ✓`
        : `Balance Sheet does not tally (Δ ₹${(bsDiff / 100).toFixed(2)}). ` +
          `Check Opening Balances and that all vouchers posted.`,
  });

  // ---- P&L sanity: if there are sales/purchase vouchers but income+expense
  // are both zero AFTER excluding closing journals, something is wrong.
  const hasTradingActivity = vouchers.some((v) =>
    ["sales", "purchase", "credit_note", "debit_note"].includes(v.voucher_type),
  );
  if (hasTradingActivity && income === 0 && expense === 0) {
    findings.push({
      key: "pl_blank_despite_activity",
      label: "P&L blank despite trading vouchers",
      severity: "warn",
      message:
        `${vouchers.filter((v) => ["sales", "purchase"].includes(v.voucher_type)).length} sales/purchase voucher(s) exist ` +
        `but Profit & Loss shows zero income AND zero expense. Likely cause: trading ledgers ` +
        `are mapped to the wrong group (Asset/Liability instead of Income/Expense). ` +
        `Open Ledgers → check 'Type' column.`,
    });
  } else if (hasTradingActivity) {
    findings.push({
      key: "pl_blank_despite_activity",
      label: "P&L reflects trading activity",
      severity: "ok",
      message: `P&L shows Income ₹${(income / 100).toFixed(2)} / Expense ₹${(expense / 100).toFixed(2)} ✓`,
    });
  }

  const hasError = findings.some((f) => f.severity === "error");
  const hasWarning = findings.some((f) => f.severity === "warn");
  const summary = hasError
    ? `${findings.filter((f) => f.severity === "error").length} critical issue(s) found — reports may be wrong.`
    : hasWarning
      ? `${findings.filter((f) => f.severity === "warn").length} warning(s) — review before relying on reports.`
      : `All ${findings.length} semantic checks passed ✓`;

  return { findings, hasError, hasWarning, summary };
}
