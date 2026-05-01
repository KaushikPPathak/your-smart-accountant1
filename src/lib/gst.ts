// GST calculation helpers — all amounts in paise (integer)
import { rupeesToPaise } from "./money";

export interface GstLineInput {
  qty: number;
  rate: number; // rupees
  discount: number; // rupees (line-level)
  gstRate: number; // %
}

export interface GstLineResult {
  amount_paise: number; // qty * rate
  discount_paise: number;
  taxable_paise: number; // amount - discount
  gst_rate: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number; // taxable + taxes
  /** Leftover 1 paise when CGST/SGST split is odd. Folded into voucher round-off. */
  rounding_paise: number;
}

/** Compute one line. interstate=true => IGST, else CGST+SGST split */
export function computeLine(input: GstLineInput, interstate: boolean): GstLineResult {
  const amount_paise = rupeesToPaise(input.qty * input.rate);
  const discount_paise = rupeesToPaise(input.discount);
  const taxable_paise = Math.max(0, amount_paise - discount_paise);
  const gstAmount = Math.round((taxable_paise * input.gstRate) / 100);

  let cgst = 0,
    sgst = 0,
    igst = 0,
    rounding = 0;
  if (interstate) {
    igst = gstAmount;
  } else {
    // GST law requires CGST = SGST on every B2B invoice (GSTN portal validates).
    // If gstAmount is odd, the leftover 1 paise becomes a voucher-level round-off
    // so each line still has CGST exactly equal to SGST.
    const half = Math.floor(gstAmount / 2);
    cgst = half;
    sgst = half;
    rounding = gstAmount - (cgst + sgst); // 0 or 1 paise
  }

  return {
    amount_paise,
    discount_paise,
    taxable_paise,
    gst_rate: input.gstRate,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: igst,
    total_paise: taxable_paise + cgst + sgst + igst + rounding,
    rounding_paise: rounding,
  };
}

export interface VoucherTotals {
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  /** Sum of per-line CGST/SGST rounding remainders (paise). Already included in total_paise. */
  rounding_paise: number;
}

export function sumLines(lines: GstLineResult[]): VoucherTotals {
  return lines.reduce<VoucherTotals>(
    (acc, l) => ({
      subtotal_paise: acc.subtotal_paise + l.taxable_paise,
      cgst_paise: acc.cgst_paise + l.cgst_paise,
      sgst_paise: acc.sgst_paise + l.sgst_paise,
      igst_paise: acc.igst_paise + l.igst_paise,
      total_paise: acc.total_paise + l.total_paise,
      rounding_paise: acc.rounding_paise + l.rounding_paise,
    }),
    { subtotal_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, total_paise: 0, rounding_paise: 0 },
  );
}

/** Determine if interstate based on company state code vs party state code */
export function isInterstate(
  companyStateCode: string | null | undefined,
  partyStateCode: string | null | undefined,
): boolean {
  if (!companyStateCode || !partyStateCode) return false;
  return companyStateCode !== partyStateCode;
}
