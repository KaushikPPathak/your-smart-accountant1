/**
 * GSTR-9 ITC reconciliation working layer.
 * Money values are paise.
 * Regular B2B can be included in GSTR-9 independently of whether its
 * purchase entry has already been entered in Books.
 */
import type { Gstr2bExcelLine } from "./gstr2b-excel-import";

export type Gstr9ItcInclusion = "INCLUDED" | "EXCLUDED";
export type Gstr9ItcMatchStatus =
  | "MATCHED"
  | "MATCHED_WITH_TOLERANCE"
  | "NOT_IN_BOOKS"
  | "BOOKS_VALUE_MISMATCH"
  | "NOT_ELIGIBLE"
  | "RCM"
  | "CDNR";

export interface Gstr9ItcPurchase {
  id: string;
  supplier_gstin: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  total_paise: number;
}

export interface Gstr9ItcReconciliationLine {
  key: string;
  section: "B2B" | "RCM" | "CDNR";
  supplier_gstin: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string | null;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
  itc_paise: number;
  itc_eligible: boolean | null;
  itc_reason: string | null;
  match_status: Gstr9ItcMatchStatus;
  matched_voucher_id: string | null;
  /** Independent user decision: should this credit flow into GSTR-9? */
  inclusion: Gstr9ItcInclusion;
  includedInGstr9: boolean;
}

export interface Gstr9ItcTotals {
  count: number;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
  itc_paise: number;
}

export interface Gstr9ItcReconciliationResult {
  regularB2b: Gstr9ItcReconciliationLine[];
  rcm: Gstr9ItcReconciliationLine[];
  cdnr: Gstr9ItcReconciliationLine[];
  regularB2bTotals: Gstr9ItcTotals;
  selectedRegularB2bTotals: Gstr9ItcTotals;
  excludedRegularB2bTotals: Gstr9ItcTotals;
  rcmTotals: Gstr9ItcTotals;
  cdnrTotals: Gstr9ItcTotals;
  matchedCount: number;
  notInBooksCount: number;
  notEligibleCount: number;
  /** Working Table 8A amount from selected eligible Regular B2B only. */
  table8AWorkingPaise: number;
  selectedGstr2bItcPaise: number;
}

export interface BuildGstr9ItcReconciliationOptions {
  /** Default is true: calculation-level equivalent of Select All. */
  defaultIncludeEligible?: boolean;
  /** Previously saved user choices keyed by stable row key. */
  inclusionByKey?: Record<string, boolean>;
  /** Default ₹2 = 200 paise. */
  invoiceValueTolerancePaise?: number;
}

export function gstr9ItcLineKey(line: Gstr2bExcelLine): string {
  return `${line.section}|${normalise(line.supplier_gstin)}|${normaliseInvoice(line.invoice_no || line.cdnr_no || "")}|${line.invoice_date ?? line.cdnr_date ?? ""}`;
}

export function itcForLine(line: Pick<Gstr2bExcelLine, "igst_paise" | "cgst_paise" | "sgst_paise" | "cess_paise">): number {
  return Number(line.igst_paise || 0) + Number(line.cgst_paise || 0) + Number(line.sgst_paise || 0) + Number(line.cess_paise || 0);
}

export function calculateItcTotals(lines: Gstr9ItcReconciliationLine[]): Gstr9ItcTotals {
  return lines.reduce((t, line) => ({
    count: t.count + 1,
    taxable_paise: t.taxable_paise + line.taxable_paise,
    igst_paise: t.igst_paise + line.igst_paise,
    cgst_paise: t.cgst_paise + line.cgst_paise,
    sgst_paise: t.sgst_paise + line.sgst_paise,
    cess_paise: t.cess_paise + line.cess_paise,
    itc_paise: t.itc_paise + line.itc_paise,
  }), emptyTotals());
}

export function setGstr9ItcInclusion(lines: Gstr9ItcReconciliationLine[], key: string, include: boolean): Gstr9ItcReconciliationLine[] {
  return lines.map((line) => {
    if (line.key !== key || line.section !== "B2B") return line;
    const allowed = line.itc_eligible !== false;
    const selected = include && allowed;
    return { ...line, inclusion: selected ? "INCLUDED" : "EXCLUDED", includedInGstr9: selected };
  });
}

/** Select/Unselect All eligible Regular B2B. Ineligible rows can never be selected. */
export function setAllEligibleGstr9ItcInclusion(lines: Gstr9ItcReconciliationLine[], include: boolean): Gstr9ItcReconciliationLine[] {
  return lines.map((line) => {
    if (line.section !== "B2B" || line.itc_eligible === false) return line;
    return { ...line, inclusion: include ? "INCLUDED" : "EXCLUDED", includedInGstr9: include };
  });
}

export function buildGstr9ItcReconciliation(
  sourceLines: Gstr2bExcelLine[],
  purchases: Gstr9ItcPurchase[] = [],
  options: BuildGstr9ItcReconciliationOptions = {},
): Gstr9ItcReconciliationResult {
  const defaultIncludeEligible = options.defaultIncludeEligible ?? true;
  const tolerance = options.invoiceValueTolerancePaise ?? 200;
  const inclusionByKey = options.inclusionByKey ?? {};
  const regularB2b: Gstr9ItcReconciliationLine[] = [];
  const rcm: Gstr9ItcReconciliationLine[] = [];
  const cdnr: Gstr9ItcReconciliationLine[] = [];

  for (const source of sourceLines) {
    const key = gstr9ItcLineKey(source);
    const eligible = source.itc_eligible !== false;
    const selected = source.section === "B2B"
      ? (inclusionByKey[key] ?? (eligible && defaultIncludeEligible))
      : false;
    const purchase = findPurchaseMatch(source, purchases);
    const matchStatus = getMatchStatus(source, purchase, tolerance);
    const row: Gstr9ItcReconciliationLine = {
      key,
      section: source.section,
      supplier_gstin: source.supplier_gstin,
      supplier_name: source.supplier_name,
      invoice_no: source.invoice_no || source.cdnr_no || "",
      invoice_date: source.invoice_date ?? source.cdnr_date ?? null,
      taxable_paise: Number(source.taxable_paise || 0),
      igst_paise: Number(source.igst_paise || 0),
      cgst_paise: Number(source.cgst_paise || 0),
      sgst_paise: Number(source.sgst_paise || 0),
      cess_paise: Number(source.cess_paise || 0),
      itc_paise: itcForLine(source),
      itc_eligible: source.itc_eligible,
      itc_reason: source.itc_reason,
      match_status: source.section === "RCM" ? "RCM" : source.section === "CDNR" ? "CDNR" : eligible ? matchStatus : "NOT_ELIGIBLE",
      matched_voucher_id: purchase?.id ?? null,
      inclusion: source.section === "B2B" && eligible && selected ? "INCLUDED" : "EXCLUDED",
      includedInGstr9: source.section === "B2B" && eligible && selected,
    };
    if (source.section === "B2B") regularB2b.push(row);
    else if (source.section === "RCM") rcm.push(row);
    else cdnr.push(row);
  }

  const selected = regularB2b.filter((x) => x.includedInGstr9 && x.itc_eligible !== false);
  const excluded = regularB2b.filter((x) => !x.includedInGstr9 || x.itc_eligible === false);
  const selectedTotals = calculateItcTotals(selected);

  return {
    regularB2b,
    rcm,
    cdnr,
    regularB2bTotals: calculateItcTotals(regularB2b),
    selectedRegularB2bTotals: selectedTotals,
    excludedRegularB2bTotals: calculateItcTotals(excluded),
    rcmTotals: calculateItcTotals(rcm),
    cdnrTotals: calculateItcTotals(cdnr),
    matchedCount: regularB2b.filter((x) => x.match_status === "MATCHED" || x.match_status === "MATCHED_WITH_TOLERANCE").length,
    notInBooksCount: regularB2b.filter((x) => x.match_status === "NOT_IN_BOOKS").length,
    notEligibleCount: regularB2b.filter((x) => x.match_status === "NOT_ELIGIBLE").length,
    table8AWorkingPaise: selectedTotals.itc_paise,
    selectedGstr2bItcPaise: selectedTotals.itc_paise,
  };
}

function findPurchaseMatch(source: Gstr2bExcelLine, purchases: Gstr9ItcPurchase[]): Gstr9ItcPurchase | null {
  if (source.section !== "B2B") return null;
  const gstin = normalise(source.supplier_gstin);
  const invoice = normaliseInvoice(source.invoice_no);
  if (!gstin || !invoice) return null;
  return purchases.find((p) => normalise(p.supplier_gstin) === gstin && normaliseInvoice(p.invoice_no ?? "") === invoice) ?? null;
}

function getMatchStatus(source: Gstr2bExcelLine, purchase: Gstr9ItcPurchase | null, tolerancePaise: number): Gstr9ItcMatchStatus {
  if (!purchase) return "NOT_IN_BOOKS";
  const difference = Math.abs(Number(source.invoice_value_paise || 0) - Number(purchase.total_paise || 0));
  if (difference === 0) return "MATCHED";
  if (difference <= tolerancePaise) return "MATCHED_WITH_TOLERANCE";
  return "BOOKS_VALUE_MISMATCH";
}

function normalise(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}
function normaliseInvoice(value: string): string {
  return normalise(value).replace(/[^A-Z0-9]/g, "");
}
function emptyTotals(): Gstr9ItcTotals {
  return { count: 0, taxable_paise: 0, igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0, itc_paise: 0 };
}
