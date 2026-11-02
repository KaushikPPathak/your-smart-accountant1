// HSN / SAC check for item masters. HSN is mandatory for every item.
//
// Rule (same as GSTR-1 validation): up to ₹5 crore turnover → 4, 6 or 8 digits;
// above ₹5 crore → 6 or 8 digits. SAC codes for services (99…) follow the same lengths.
import { hsnDigitsForTurnover } from "@/lib/inventory/stock-by-hsn";

/** Returns the reason the code is not acceptable, or null when it is valid. */
export function itemHsnError(code: string | null | undefined, turnoverPaise: number): string | null {
  const h = String(code ?? "").trim();
  if (!h) return "HSN / SAC code is required for every item.";
  if (!/^[0-9]+$/.test(h)) return `HSN "${h}" must contain digits only.`;
  const digits = hsnDigitsForTurnover(turnoverPaise);
  const allowed = digits === 6 ? [6, 8] : [4, 6, 8];
  if (!allowed.includes(h.length)) {
    return digits === 6
      ? `Turnover is above ₹5 crore, so HSN must be 6 or 8 digits (you entered ${h.length}).`
      : `HSN must be 4, 6 or 8 digits (you entered ${h.length}).`;
  }
  return null;
}
