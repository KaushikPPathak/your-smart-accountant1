// Section 170, CGST Act: tax shown on a return is rounded to the nearest rupee, with 50 paise or more
// rounding up and less than 50 paise dropped. This is a filing rule. It is applied to return lines
// only and is never posted back to the ledger, which keeps exact paise.

/** Tax keys that carry a rupee amount on a return line. Taxable values (txval) are not tax and are left alone. */
const TAX_KEYS = new Set([
  "iamt", "camt", "samt", "csamt",
  "iamt_payable", "camt_payable", "samt_payable", "csamt_payable",
]);

/** Round one tax amount (rupees, up to 2 decimals) to the nearest rupee. Negative amounts round symmetrically. */
export function roundTaxToRupee(rupees: number): number {
  const paise = Math.round(rupees * 100);
  const sign = paise < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(paise) + 50) / 100);
}

/** Deep copy of a return object with every tax-head amount rounded per Section 170. */
export function roundReturnTaxes<T>(node: T): T {
  if (Array.isArray(node)) return node.map((x) => roundReturnTaxes(x)) as unknown as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = TAX_KEYS.has(k) && typeof v === "number" ? roundTaxToRupee(v) : roundReturnTaxes(v);
    }
    return out as T;
  }
  return node;
}
