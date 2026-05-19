// Auto-create system ledgers and post double-entry for item vouchers.
import { supabase } from "@/integrations/supabase/client";

type LedgerType =
  | "income_direct"
  | "expense_direct"
  | "duties_taxes"
  | "expense_indirect"
  | "income_indirect"
  | "fixed_asset";

interface SystemLedgerSpec {
  name: string;
  type: LedgerType;
}

const SALES: SystemLedgerSpec = { name: "Sales A/c", type: "income_direct" };
const PURCHASE: SystemLedgerSpec = { name: "Purchase A/c", type: "expense_direct" };
const SALES_RETURN: SystemLedgerSpec = { name: "Sales Return A/c", type: "income_direct" };
const PURCHASE_RETURN: SystemLedgerSpec = { name: "Purchase Return A/c", type: "expense_direct" };
const CAPITAL_GOODS: SystemLedgerSpec = { name: "Capital Goods (Fixed Assets)", type: "fixed_asset" };
const INPUT_SERVICES: SystemLedgerSpec = { name: "Input Services (Expense)", type: "expense_indirect" };
const OUT_CGST: SystemLedgerSpec = { name: "Output CGST", type: "duties_taxes" };
const OUT_SGST: SystemLedgerSpec = { name: "Output SGST", type: "duties_taxes" };
const OUT_IGST: SystemLedgerSpec = { name: "Output IGST", type: "duties_taxes" };
const IN_CGST: SystemLedgerSpec = { name: "Input CGST (Electronic Credit Ledger)", type: "duties_taxes" };
const IN_SGST: SystemLedgerSpec = { name: "Input SGST (Electronic Credit Ledger)", type: "duties_taxes" };
const IN_IGST: SystemLedgerSpec = { name: "Input IGST (Electronic Credit Ledger)", type: "duties_taxes" };
const ROUND_OFF: SystemLedgerSpec = { name: "Round Off", type: "expense_indirect" };

async function getOrCreateLedger(companyId: string, spec: SystemLedgerSpec): Promise<string> {
  const { data: existing } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", spec.name)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from("ledgers")
    .insert({ company_id: companyId, name: spec.name, type: spec.type })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export type ItemVoucherKind = "sales" | "purchase" | "credit_note" | "debit_note";
export type ItcClass = "inputs" | "capital_goods" | "input_services" | "ineligible" | "na";

export interface PostingTotals {
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  /** Round-off paise included in total_paise. Posted to "Round Off" ledger to keep books balanced. */
  round_off_paise?: number;
}

export interface PostingOptions {
  /** Purchase-side classification. Ignored for sales/credit_note. */
  itcClass?: ItcClass;
  /** When false (or itcClass = 'ineligible'), GST is capitalised into the debit ledger and no Input GST is posted. */
  itcEligible?: boolean;
}

export interface PostingEntry {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  line_no: number;
  narration?: string | null;
}

export async function buildItemVoucherPostings(
  companyId: string,
  kind: ItemVoucherKind,
  partyLedgerId: string,
  totals: PostingTotals,
  options: PostingOptions = {},
): Promise<PostingEntry[]> {
  const isSalesSide = kind === "sales" || kind === "credit_note";
  const isPurchaseSide = !isSalesSide;
  const cgstSpec = isSalesSide ? OUT_CGST : IN_CGST;
  const sgstSpec = isSalesSide ? OUT_SGST : IN_SGST;
  const igstSpec = isSalesSide ? OUT_IGST : IN_IGST;

  // Determine the "base" (non-tax) debit ledger for purchase-side based on ITC classification.
  let revenueSpec: SystemLedgerSpec;
  if (kind === "sales") revenueSpec = SALES;
  else if (kind === "credit_note") revenueSpec = SALES_RETURN;
  else if (kind === "debit_note") revenueSpec = PURCHASE_RETURN;
  else {
    // purchase: route by itc_class
    switch (options.itcClass) {
      case "capital_goods":
        revenueSpec = CAPITAL_GOODS;
        break;
      case "input_services":
        revenueSpec = INPUT_SERVICES;
        break;
      default:
        revenueSpec = PURCHASE; // inputs / na / ineligible (raw material/stock) defaults to Purchase A/c
    }
  }

  // ITC eligibility: ineligible class OR itcEligible=false → capitalise GST into the base debit ledger.
  const capitaliseTax =
    isPurchaseSide && (options.itcClass === "ineligible" || options.itcEligible === false);

  const baseTax = capitaliseTax ? totals.cgst_paise + totals.sgst_paise + totals.igst_paise : 0;
  const effectiveBase = totals.subtotal_paise + baseTax;
  const postCgst = !capitaliseTax && totals.cgst_paise > 0;
  const postSgst = !capitaliseTax && totals.sgst_paise > 0;
  const postIgst = !capitaliseTax && totals.igst_paise > 0;

  const revenueId = await getOrCreateLedger(companyId, revenueSpec);
  const cgstId = postCgst || (isSalesSide && totals.cgst_paise) ? await getOrCreateLedger(companyId, cgstSpec) : null;
  const sgstId = postSgst || (isSalesSide && totals.sgst_paise) ? await getOrCreateLedger(companyId, sgstSpec) : null;
  const igstId = postIgst || (isSalesSide && totals.igst_paise) ? await getOrCreateLedger(companyId, igstSpec) : null;
  const roundOff = totals.round_off_paise ?? 0;
  const roundOffId = roundOff !== 0 ? await getOrCreateLedger(companyId, ROUND_OFF) : null;

  const entries: PostingEntry[] = [];
  let line = 1;

  if (kind === "sales") {
    entries.push({ ledger_id: partyLedgerId, debit_paise: totals.total_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: revenueId, debit_paise: 0, credit_paise: totals.subtotal_paise, line_no: line++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: totals.cgst_paise, line_no: line++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: totals.sgst_paise, line_no: line++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: totals.igst_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: roundOff, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: -roundOff, credit_paise: 0, line_no: line++ });
  } else if (kind === "purchase") {
    entries.push({ ledger_id: revenueId, debit_paise: effectiveBase, credit_paise: 0, line_no: line++ });
    if (postCgst && cgstId) entries.push({ ledger_id: cgstId, debit_paise: totals.cgst_paise, credit_paise: 0, line_no: line++ });
    if (postSgst && sgstId) entries.push({ ledger_id: sgstId, debit_paise: totals.sgst_paise, credit_paise: 0, line_no: line++ });
    if (postIgst && igstId) entries.push({ ledger_id: igstId, debit_paise: totals.igst_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: partyLedgerId, debit_paise: 0, credit_paise: totals.total_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: roundOff, credit_paise: 0, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: -roundOff, line_no: line++ });
  } else if (kind === "credit_note") {
    entries.push({ ledger_id: revenueId, debit_paise: totals.subtotal_paise, credit_paise: 0, line_no: line++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: totals.cgst_paise, credit_paise: 0, line_no: line++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: totals.sgst_paise, credit_paise: 0, line_no: line++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: totals.igst_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: partyLedgerId, debit_paise: 0, credit_paise: totals.total_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: roundOff, credit_paise: 0, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: -roundOff, line_no: line++ });
  } else {
    // debit_note (purchase return)
    entries.push({ ledger_id: partyLedgerId, debit_paise: totals.total_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: revenueId, debit_paise: 0, credit_paise: effectiveBase, line_no: line++ });
    if (postCgst && cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: totals.cgst_paise, line_no: line++ });
    if (postSgst && sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: totals.sgst_paise, line_no: line++ });
    if (postIgst && igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: totals.igst_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: roundOff, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: -roundOff, credit_paise: 0, line_no: line++ });
  }

  return entries;
}
