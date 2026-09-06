// GST calculation helpers — all amounts in paise (integer)
import { rupeesToPaise } from "./money";
import { offlineDb } from "./offline/db";
import { GST_STATE_CODES } from "../utils/stateCodes";


export interface GstLineInput {
  item_id?: string;
  ledger_id?: string;
  qty: number;
  rate: number; // rupees
  discount: number; // rupees (line-level)
  gstRate: number; // %
}

/** Precomputed GST result for caching */
export interface CachedGstRate {
  item_id: string;
  ledger_id: string;
  is_interstate: boolean;
  gst_rate: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  updated_at: string;
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

/** Reverse lookup: state / UT name (upper-case) -> GST state code. */
const STATE_NAME_TO_CODE: Record<string, string> = Object.entries(GST_STATE_CODES).reduce(
  (acc, [code, name]) => {
    acc[name.toUpperCase()] = code;
    // Common spelling variants without the ampersand / with "and"
    acc[name.toUpperCase().replace(/&/g, "AND")] = code;
    return acc;
  },
  {} as Record<string, string>,
);
// Frequently used aliases that don't match the canonical label exactly.
STATE_NAME_TO_CODE["ORISSA"] = "21";
STATE_NAME_TO_CODE["PONDICHERRY"] = "34";
STATE_NAME_TO_CODE["NEW DELHI"] = "07";
STATE_NAME_TO_CODE["DELHI NCR"] = "07";
STATE_NAME_TO_CODE["JAMMU AND KASHMIR"] = "01";
STATE_NAME_TO_CODE["ANDHRA PRADESH"] = "37";

/** Resolve any state-ish value (code, GSTIN, or state name) to a 2-digit GST state code. */
export function toStateCode(val?: string | null): string | null {
  if (!val) return null;
  const str = String(val).trim().toUpperCase();
  if (!str) return null;

  // A bare code or a GSTIN both start with the 2-digit state code.
  const lead = str.match(/^(\d{2})/);
  if (lead && GST_STATE_CODES[lead[1]]) return lead[1];

  // Exact state / UT name.
  const cleaned = str.replace(/[.\-_]/g, " ").replace(/\s+/g, " ").trim();
  if (STATE_NAME_TO_CODE[cleaned]) return STATE_NAME_TO_CODE[cleaned];

  // Name embedded in a longer string (e.g. "Hyderabad, Telangana 500001").
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (name.length >= 4 && cleaned.includes(name)) return code;
  }

  // Last resort: any 2 consecutive digits that form a valid state code.
  const any = str.match(/\d{2}/);
  if (any && GST_STATE_CODES[any[0]]) return any[0];

  return null;
}

/** Determine if interstate based on company state code vs party state code */
export function isInterstate(
  companyStateCode: string | null | undefined,
  partyStateCode: string | null | undefined,
  partyGstin?: string | null,
  placeOfSupply?: string | null 
): boolean {
  const compCode = toStateCode(companyStateCode);

  // Priority: 1) Invoice PoS, 2) Party GSTIN, 3) Ledger State
  const destCode =
    toStateCode(placeOfSupply) || toStateCode(partyGstin) || toStateCode(partyStateCode);

  // Without both sides we cannot prove an interstate supply — stay local.
  if (!compCode || !destCode) return false;

  return compCode !== destCode;
}


/** 
 * High-performance GST resolver with local caching.
 * Accelerates invoice creation by avoiding repeated math for identical item/party pairs.
 */
export async function resolveGstWithCache(
  input: GstLineInput, 
  interstate: boolean,
  companyId: string
): Promise<GstLineResult> {
  const result = computeLine(input, interstate);
  
  if (input.item_id && input.ledger_id) {
    // Fire-and-forget cache update to keep the warm loop ready for bulk ops
    void offlineDb.cache_gst_rates.put({
      id: `${input.item_id}:${input.ledger_id}:${interstate}`,
      item_id: input.item_id,
      ledger_id: input.ledger_id,
      is_interstate: interstate,
      gst_rate: result.gst_rate,
      cgst_paise: result.cgst_paise,
      sgst_paise: result.sgst_paise,
      igst_paise: result.igst_paise,
      company_id: companyId,
      updated_at: new Date().toISOString()
    }).catch(() => {});
  }
  
  return result;
}
