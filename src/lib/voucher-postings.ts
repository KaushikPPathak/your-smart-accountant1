// Auto-create system ledgers and post double-entry for item vouchers.
import { supabase } from "@/integrations/supabase/client";

type LedgerType =
  | "income_direct"
  | "expense_direct"
  | "duties_taxes"
  | "expense_indirect"
  | "income_indirect";

interface SystemLedgerSpec {
  name: string;
  type: LedgerType;
}

const SALES: SystemLedgerSpec = { name: "Sales A/c", type: "income_direct" };
const PURCHASE: SystemLedgerSpec = { name: "Purchase A/c", type: "expense_direct" };
const SALES_RETURN: SystemLedgerSpec = { name: "Sales Return A/c", type: "income_direct" };
const PURCHASE_RETURN: SystemLedgerSpec = { name: "Purchase Return A/c", type: "expense_direct" };
const OUT_CGST: SystemLedgerSpec = { name: "Output CGST", type: "duties_taxes" };
const OUT_SGST: SystemLedgerSpec = { name: "Output SGST", type: "duties_taxes" };
const OUT_IGST: SystemLedgerSpec = { name: "Output IGST", type: "duties_taxes" };
const IN_CGST: SystemLedgerSpec = { name: "Input CGST", type: "duties_taxes" };
const IN_SGST: SystemLedgerSpec = { name: "Input SGST", type: "duties_taxes" };
const IN_IGST: SystemLedgerSpec = { name: "Input IGST", type: "duties_taxes" };
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

export interface PostingTotals {
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  /** Round-off paise included in total_paise. Posted to "Round Off" ledger to keep books balanced. */
  round_off_paise?: number;
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
): Promise<PostingEntry[]> {
  // For sales/credit_note tax is Output; purchase/debit_note tax is Input.
  const isSalesSide = kind === "sales" || kind === "credit_note";
  const cgstSpec = isSalesSide ? OUT_CGST : IN_CGST;
  const sgstSpec = isSalesSide ? OUT_SGST : IN_SGST;
  const igstSpec = isSalesSide ? OUT_IGST : IN_IGST;

  let revenueSpec: SystemLedgerSpec;
  if (kind === "sales") revenueSpec = SALES;
  else if (kind === "purchase") revenueSpec = PURCHASE;
  else if (kind === "credit_note") revenueSpec = SALES_RETURN;
  else revenueSpec = PURCHASE_RETURN;

  const revenueId = await getOrCreateLedger(companyId, revenueSpec);
  const cgstId = totals.cgst_paise ? await getOrCreateLedger(companyId, cgstSpec) : null;
  const sgstId = totals.sgst_paise ? await getOrCreateLedger(companyId, sgstSpec) : null;
  const igstId = totals.igst_paise ? await getOrCreateLedger(companyId, igstSpec) : null;
  const roundOff = totals.round_off_paise ?? 0;
  const roundOffId = roundOff !== 0 ? await getOrCreateLedger(companyId, ROUND_OFF) : null;

  const entries: PostingEntry[] = [];
  let line = 1;

  // Sales: Dr Party (total) / Cr Sales (subtotal) + Cr Output GST
  // Purchase: Dr Purchase + Dr Input GST / Cr Party
  // Credit note (sales return): Dr Sales Return + Dr Output GST / Cr Party
  // Debit note (purchase return): Dr Party / Cr Purchase Return + Cr Input GST
  if (kind === "sales") {
    entries.push({ ledger_id: partyLedgerId, debit_paise: totals.total_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: revenueId, debit_paise: 0, credit_paise: totals.subtotal_paise, line_no: line++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: totals.cgst_paise, line_no: line++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: totals.sgst_paise, line_no: line++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: totals.igst_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: roundOff, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: -roundOff, credit_paise: 0, line_no: line++ });
  } else if (kind === "purchase") {
    entries.push({ ledger_id: revenueId, debit_paise: totals.subtotal_paise, credit_paise: 0, line_no: line++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: totals.cgst_paise, credit_paise: 0, line_no: line++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: totals.sgst_paise, credit_paise: 0, line_no: line++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: totals.igst_paise, credit_paise: 0, line_no: line++ });
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
    // debit_note
    entries.push({ ledger_id: partyLedgerId, debit_paise: totals.total_paise, credit_paise: 0, line_no: line++ });
    entries.push({ ledger_id: revenueId, debit_paise: 0, credit_paise: totals.subtotal_paise, line_no: line++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: totals.cgst_paise, line_no: line++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: totals.sgst_paise, line_no: line++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: totals.igst_paise, line_no: line++ });
    if (roundOffId && roundOff > 0) entries.push({ ledger_id: roundOffId, debit_paise: 0, credit_paise: roundOff, line_no: line++ });
    if (roundOffId && roundOff < 0) entries.push({ ledger_id: roundOffId, debit_paise: -roundOff, credit_paise: 0, line_no: line++ });
  }

  return entries;
}
