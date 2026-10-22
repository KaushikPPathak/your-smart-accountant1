import type { Gstr9Result, Gstr9TaxTotals } from "./gstr9";
import type { Gstr9Table4, Gstr9Table5, Gstr9TaxAmount } from "./gstr9-inputs";

/**
 * Rows printed in the GSTR-9 PDF working paper (Tables 4 and 5).
 *
 * Rows the books engine computes come from `result.outward` so the PDF
 * always matches the Excel exports; only rows the engine does not track
 * (SEZ, advances, RCM, recipient-pays) fall back to the saved
 * "Filed GSTR-1" input. Subtotals are the sum of the printed rows so the
 * PDF always reconciles.
 */
export interface Gstr9PrintTaxRow {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr9PrintOutward {
  t4A?: Gstr9PrintTaxRow;
  t4B?: Gstr9PrintTaxRow;
  t4C?: Gstr9PrintTaxRow;
  t4D?: Gstr9PrintTaxRow;
  t4E?: Gstr9PrintTaxRow;
  t4F?: Gstr9PrintTaxRow;
  t4G?: Gstr9PrintTaxRow;
  h4: Gstr9PrintTaxRow;
  m4: Gstr9PrintTaxRow;
  n4: Gstr9PrintTaxRow;
  t5A?: Gstr9PrintTaxRow;
  t5B?: Gstr9PrintTaxRow;
  t5C?: Gstr9PrintTaxRow;
  t5D?: Gstr9PrintTaxRow;
  t5E?: Gstr9PrintTaxRow;
  t5F?: Gstr9PrintTaxRow;
  g5: Gstr9PrintTaxRow;
}

const zero: Gstr9PrintTaxRow = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

function pickRow(
  books: Gstr9TaxTotals | undefined,
  input: Gstr9TaxAmount | undefined,
): Gstr9PrintTaxRow | undefined {
  const source = books ?? input;
  if (!source) return undefined;
  return {
    taxableValue: source.taxableValue,
    igst: source.igst,
    cgst: source.cgst,
    sgst: source.sgst,
    cess: source.cess,
  };
}

export function sumGstr9PrintRows(
  ...rows: Array<Gstr9PrintTaxRow | undefined>
): Gstr9PrintTaxRow {
  return rows.reduce<Gstr9PrintTaxRow>(
    (acc, r) => ({
      taxableValue: acc.taxableValue + (r?.taxableValue ?? 0),
      igst: acc.igst + (r?.igst ?? 0),
      cgst: acc.cgst + (r?.cgst ?? 0),
      sgst: acc.sgst + (r?.sgst ?? 0),
      cess: acc.cess + (r?.cess ?? 0),
    }),
    { ...zero },
  );
}

export function resolveGstr9PrintOutward(
  result: Gstr9Result | null | undefined,
  table4: Gstr9Table4 | undefined,
  table5: Gstr9Table5 | undefined,
): Gstr9PrintOutward {
  const cn = result?.notes.creditNotes ?? zero;
  const dn = result?.notes.debitNotes ?? zero;
  const m4: Gstr9PrintTaxRow = {
    taxableValue: dn.taxableValue - cn.taxableValue,
    igst: dn.igst - cn.igst,
    cgst: dn.cgst - cn.cgst,
    sgst: dn.sgst - cn.sgst,
    cess: dn.cess - cn.cess,
  };

  const t4A = pickRow(result?.outward.unregisteredTaxable, table4?.b2cOther);
  const t4B = pickRow(result?.outward.registeredTaxable, table4?.b2b);
  const t4C = pickRow(result?.outward.zeroRatedWithPayment, table4?.exportsWithPayment);
  const t4D = pickRow(undefined, table4?.sezWithPayment);
  const t4E = pickRow(result?.outward.deemedExport, table4?.deemedExports);
  const t4F = pickRow(undefined, table4?.advancesTaxPaid);
  const t4G = pickRow(undefined, table4?.inwardSuppliesRcm);
  const h4 = sumGstr9PrintRows(t4A, t4B, t4C, t4D, t4E, t4F, t4G);
  const n4 = sumGstr9PrintRows(h4, m4);

  const t5A = pickRow(result?.outward.zeroRatedWithoutPayment, table5?.exportsWithoutPayment);
  const t5B = pickRow(undefined, table5?.sezWithoutPayment);
  const t5C = pickRow(undefined, table5?.suppliesOnWhichTaxPayableByRecipient);
  const t5D = pickRow(result?.outward.exempt, table5?.exemptSupplies);
  const t5E = pickRow(result?.outward.nilRated, table5?.nilRatedSupplies);
  const t5F = pickRow(result?.outward.nonGst, table5?.nonGstSupplies);
  const g5 = sumGstr9PrintRows(t5A, t5B, t5C, t5D, t5E, t5F);

  return { t4A, t4B, t4C, t4D, t4E, t4F, t4G, h4, m4, n4, t5A, t5B, t5C, t5D, t5E, t5F, g5 };
}
