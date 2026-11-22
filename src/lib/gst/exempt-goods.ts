// Per-line nature for tax-free (0%) lines: exempt when the HSN is in the exempt-goods
// notification list, otherwise nil-rated. Only zero-rate lines are considered; a line
// with a GST rate above zero is taxable whatever its HSN.
import { EXEMPT_GOODS, type ExemptEntry } from "./exempt-goods-data";
import { isTaxFreeGstLine } from "@/lib/gst-supply-classification";

export type TaxFreeNature = "exempt" | "nil_rated";

/** The exempt entry an HSN falls under, or null. Free-text entries never match. */
export function exemptEntryForHsn(hsn: string | null | undefined): ExemptEntry | null {
  const code = String(hsn ?? "").replace(/\D/g, "");
  if (code.length < 2) return null;
  for (const e of EXEMPT_GOODS) {
    if (!e.autoMatch) continue;
    if (e.scopes.some((s) => code.startsWith(s))) return e;
  }
  return null;
}

/** Nature of a zero-rate line: "exempt" if its item's HSN is an exempt entry, else nil-rated. */
export function natureOfTaxFreeLine(line: {
  gst_rate: number; igst_paise: number; cgst_paise: number; sgst_paise: number;
  items?: { hsn_code?: string | null } | null;
}): TaxFreeNature {
  if (!isTaxFreeGstLine(line)) return "nil_rated";
  return exemptEntryForHsn(line.items?.hsn_code) ? "exempt" : "nil_rated";
}

/** Short label for a 0% code in the HSN picker. */
export function taxFreeLabel(hsn: string | null | undefined): string {
  const e = exemptEntryForHsn(hsn);
  return e ? `Exempt · Notif 10/2025 entry ${e.serial}` : "Nil rated (0%)";
}
