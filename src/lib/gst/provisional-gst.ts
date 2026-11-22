// 6.1: provisional net GST payable for chat. Read-only. The figure is derived from the same GSTR-3B
// build the report screen uses, labelled provisional, and refused when the answer would not be
// safe to act on: the period is locked, books are incomplete, or the ITC in books differs from
// GSTR-2B by more than the company's tolerance (the 5.4 rule).
import {
  buildGstr3B, fetchCompanyMeta, fetchInwardSummary, fetchItcReversal, fetchVouchers, type BuiltGstr3B,
} from "@/lib/gst-returns";
import { loadItcClassInputs } from "@/lib/gst-itc-inputs";
import { mergeInwardSummaries, resolveGstPeriod, defaultSelection } from "@/lib/gst-period";
import { fetchLockFor } from "@/lib/period-locks";
import { loadAllImportLines } from "@/lib/gstr2b-local-store";
import { g2bPeriodInRange } from "@/lib/gstr2b-periods";
import { countVarianceNeedsReason, loadPolicy } from "@/lib/policy-settings";
import { formatINR } from "@/lib/money";

export const GSTR3B_SCREEN_PATH = "/app/reports/gstr3b";

export interface ProvisionalGstResult {
  status: "provisional" | "refused";
  /** Why the figure was refused. Only set when status is "refused". */
  reason?: string;
  period: { month: string; label: string; from: string; to: string; fp: string };
  /** Net cash payable per head, rupees, Section 170 rounded. Only set when provisional. */
  netPayableRupees?: { igst: number; cgst: number; sgst: number; total: number };
  reconciliation: { state: "within_tolerance" | "not_imported" | "mismatch"; note: string };
  screenPath: string;
}

export interface ProvisionalGstOptions {
  companyId: string;
  /** "YYYY-MM" month. */
  month: string;
}

/** Books ITC vs GSTR-2B ITC for one period, in paise. Null when no GSTR-2B covers the period. */
async function reconciliationFor(
  companyId: string,
  fp: string,
  from: string,
  to: string,
  booksItcPaise: number,
): Promise<{ state: ProvisionalGstResult["reconciliation"]["state"]; note: string; refuse?: string }> {
  const lines = await loadAllImportLines(companyId);
  const inPeriod = lines.filter((l) => g2bPeriodInRange(l.gstr2b_period, l.import_period, { fps: [fp], from, to }));
  if (inPeriod.length === 0) {
    return { state: "not_imported", note: "Not reconciled to GSTR-2B: no GSTR-2B has been imported for this period." };
  }
  const twoBPaise = inPeriod
    .filter((l) => l.itc_eligible !== false)
    .reduce((s, l) => s + (l.igst_paise || 0) + (l.cgst_paise || 0) + (l.sgst_paise || 0), 0);
  const policy = await loadPolicy(companyId);
  const diff = Math.abs(booksItcPaise - twoBPaise);
  if (countVarianceNeedsReason(diff, twoBPaise, policy)) {
    return {
      state: "mismatch",
      note: `ITC in books differs from GSTR-2B by ${formatINR(diff)}, above the tolerance.`,
      refuse: `Books and GSTR-2B differ on input tax by ${formatINR(diff)}, beyond the company's tolerance. Reconcile on the GSTR-2B report first.`,
    };
  }
  return { state: "within_tolerance", note: "Reconciled to GSTR-2B within the company's tolerance." };
}

/** Provisional net GST payable for a month. Never writes; the figure is for reading, not for filing. */
export async function provisionalNetGst(opts: ProvisionalGstOptions): Promise<ProvisionalGstResult> {
  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    return {
      status: "refused",
      reason: "Give the month as YYYY-MM.",
      period: { month: opts.month, label: "", from: "", to: "", fp: "" },
      reconciliation: { state: "not_imported", note: "" },
      screenPath: GSTR3B_SCREEN_PATH,
    };
  }
  const sel = { ...defaultSelection("monthly"), mode: "month" as const, month: opts.month };
  const period = resolveGstPeriod(sel);
  const base = {
    period: { month: opts.month, label: period.label, from: period.from, to: period.to, fp: period.fp },
    screenPath: GSTR3B_SCREEN_PATH,
    reconciliation: { state: "not_imported" as const, note: "" },
  };
  if (!period.valid) return { ...base, status: "refused", reason: "Give the month as YYYY-MM." };

  const lock = await fetchLockFor(opts.companyId, "GSTR3B", period.fp);
  if (lock) {
    return { ...base, status: "refused", reason: `${period.label} is locked. Use the GSTR-3B report for the filed figure.` };
  }

  const [sales, purchases, creditNotes, debitNotes] = await Promise.all([
    fetchVouchers(opts.companyId, period.from, period.to, ["sales"]),
    fetchVouchers(opts.companyId, period.from, period.to, ["purchase"]),
    fetchVouchers(opts.companyId, period.from, period.to, ["credit_note"]),
    fetchVouchers(opts.companyId, period.from, period.to, ["debit_note"]),
  ]);
  const incomplete = [...sales, ...purchases, ...creditNotes, ...debitNotes].filter((v) => !v.supply_nature).length;
  if (incomplete > 0) {
    return {
      ...base,
      status: "refused",
      reason: `${incomplete} voucher(s) in ${period.label} have no supply type set, so the books are incomplete. Fix them on the entry screen first.`,
    };
  }

  const company = await fetchCompanyMeta(opts.companyId);
  const [inward, reversal, itcInputs] = await Promise.all([
    fetchInwardSummary(opts.companyId, period.fp),
    fetchItcReversal(opts.companyId, period.fp),
    loadItcClassInputs(opts.companyId, period.from, period.to),
  ]);
  const built: BuiltGstr3B = buildGstr3B({
    company, from: period.from, to: period.to, fp: period.fp,
    sales, purchases, creditNotes, debitNotes,
    inwardSummary: mergeInwardSummaries(inward), itcReversal: reversal,
    purchaseBuckets: itcInputs.purchaseBuckets, journalItc: itcInputs.journalItc,
  });

  const exactItc = built.unrounded?.itc_elg.itc_net;
  const booksItcPaise = Math.round(((exactItc?.iamt ?? 0) + (exactItc?.camt ?? 0) + (exactItc?.samt ?? 0)) * 100);
  const rec = await reconciliationFor(opts.companyId, period.fp, period.from, period.to, booksItcPaise);
  if (rec.refuse) return { ...base, reconciliation: { state: rec.state, note: rec.note }, status: "refused", reason: rec.refuse };

  const p = built.tax_pmt;
  const igst = p.iamt_payable, cgst = p.camt_payable, sgst = p.samt_payable;
  return {
    ...base,
    status: "provisional",
    reconciliation: { state: rec.state, note: rec.note },
    netPayableRupees: { igst, cgst, sgst, total: igst + cgst + sgst },
  };
}
