/**
 * GSTR-9 Input Data Model
 * Step 1: structured contract for manual entry and import.
 * Money values are RUPEES.
 */
export type Gstr9InputSource = "MANUAL" | "IMPORT";
export type Gstr9InputStatus = "INPUT_REQUIRED" | "MANUAL" | "IMPORTED" | "NOT_AVAILABLE";

export interface Gstr9TaxAmount {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr9Table4 {
  b2b: Gstr9TaxAmount;
  b2cLarge: Gstr9TaxAmount;
  exportsWithPayment: Gstr9TaxAmount;
  sezWithPayment: Gstr9TaxAmount;
  deemedExports: Gstr9TaxAmount;
  advancesTaxPaid: Gstr9TaxAmount;
  inwardSuppliesRcm: Gstr9TaxAmount;
  b2cOther: Gstr9TaxAmount;
  exportsWithoutPayment: Gstr9TaxAmount;
  sezWithoutPayment: Gstr9TaxAmount;
  advancesTaxAdjusted: Gstr9TaxAmount;
  otherOutwardTaxableSupplies: Gstr9TaxAmount;
  total: Gstr9TaxAmount;
}

export interface Gstr9Table5 {
  exportsWithoutPayment: Gstr9TaxAmount;
  sezWithoutPayment: Gstr9TaxAmount;
  suppliesOnWhichTaxPayableByRecipient: Gstr9TaxAmount;
  exemptSupplies: Gstr9TaxAmount;
  nilRatedSupplies: Gstr9TaxAmount;
  nonGstSupplies: Gstr9TaxAmount;
  total: Gstr9TaxAmount;
}

export interface Gstr9TaxPaid {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  interest: number;
  lateFee: number;
  penalty: number;
  others: number;
}

export interface Gstr9Gstr3bPeriod {
  period: string;
  outwardTax: Gstr9TaxAmount;
  itc: {
    table4A1ImportOfGoods: number;
    table4A2ImportOfServices: number;
    table4A3Rcm: number;
    table4A4Isd: number;
    table4A5Other: number;
    totalItcAvailed: number;
  };
  itcReversal: {
    rule38: number;
    rule42: number;
    rule43: number;
    section17_5: number;
    other: number;
    total: number;
  };
  taxPaid: Gstr9TaxPaid;
}

export interface Gstr9Gstr2bPeriod {
  period: string;
  itcAvailable: {
    importOfGoods: number;
    importOfServices: number;
    reverseCharge: number;
    isd: number;
    otherRegisteredSupplies: number;
    total: number;
  };
  itcNotAvailable: {
    section16_4: number;
    posRestriction: number;
    other: number;
    total: number;
  };
}

export interface Gstr9Table6 {
  importOfGoods: number;
  importOfServices: number;
  inwardSuppliesRcm: number;
  inwardSuppliesIsd: number;
  allOtherItc: number;
  totalItcAvailed: number;
  precedingFinancialYearItc: number;
}

export interface Gstr9Table7 {
  rule38: number;
  rule39: number;
  rule42: number;
  rule43: number;
  section17_5: number;
  reversalUnderRule37: number;
  reversalUnderRule37A: number;
  otherReversals: number;
  total: number;
}

export interface Gstr9Table8 {
  itcAsPerGstr2bTable8A: number;
  itcAsPerBooks: number;
  creditAvailableButNotAvailed: number;
  creditAvailableIneligible: number;
  creditIneligibleUnderSection16_4: number;
  totalOtherItc: number;
}

export interface Gstr9InputMetadata {
  source: Gstr9InputSource;
  enteredAt: string;
  updatedAt: string;
  sourceName?: string;
  sourceReference?: string;
  notes?: string;
}

export interface Gstr9InputRecord {
  id: string;
  companyId: string;
  financialYear: string;
  gstr1?: { table4: Gstr9Table4; table5: Gstr9Table5; metadata: Gstr9InputMetadata };
  gstr3b?: { periods: Gstr9Gstr3bPeriod[]; metadata: Gstr9InputMetadata };
  gstr2b?: { periods: Gstr9Gstr2bPeriod[]; metadata: Gstr9InputMetadata };
  itcTables?: { table6: Gstr9Table6; table7: Gstr9Table7; table8: Gstr9Table8; metadata: Gstr9InputMetadata };
  taxPayment?: { table9: { taxPaid: Gstr9TaxPaid }; basedOnBooks: boolean; metadata: Gstr9InputMetadata };
}

export interface Gstr9InputStatusSummary {
  gstr1: Gstr9InputStatus;
  gstr3b: Gstr9InputStatus;
  gstr2b: Gstr9InputStatus;
  itcTables: Gstr9InputStatus;
  taxPayment: Gstr9InputStatus;
}

export function emptyTaxAmount(): Gstr9TaxAmount {
  return { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

export function emptyTaxPaid(): Gstr9TaxPaid {
  return { igst: 0, cgst: 0, sgst: 0, cess: 0, interest: 0, lateFee: 0, penalty: 0, others: 0 };
}

export function inputStatus(value: { metadata: Gstr9InputMetadata } | undefined): Gstr9InputStatus {
  if (!value) return "INPUT_REQUIRED";
  return value.metadata.source === "IMPORT" ? "IMPORTED" : "MANUAL";
}

export function getGstr9InputStatus(record: Gstr9InputRecord | null | undefined): Gstr9InputStatusSummary {
  return {
    gstr1: inputStatus(record?.gstr1),
    gstr3b: inputStatus(record?.gstr3b),
    gstr2b: inputStatus(record?.gstr2b),
    itcTables: inputStatus(record?.itcTables),
    taxPayment: inputStatus(record?.taxPayment),
  };
}

/** GST tax only; interest, late fee, penalty and other amounts are excluded. */
export function totalGstrTaxPaid(taxPaid: Gstr9TaxPaid): number {
  return taxPaid.igst + taxPaid.cgst + taxPaid.sgst + taxPaid.cess;
}

export function totalGstrNonTaxPayment(taxPaid: Gstr9TaxPaid): number {
  return taxPaid.interest + taxPaid.lateFee + taxPaid.penalty + taxPaid.others;
}

export function createGstr9InputId(companyId: string, financialYear: string): string {
  return `${companyId}:${financialYear}`;
}
