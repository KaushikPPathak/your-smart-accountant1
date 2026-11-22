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

export interface TaxDelta {
  /** Path to the return figure, e.g. "tax_pmt.iamt_payable" or "itc_elg.itc_avl[0].camt". */
  path: string;
  /** Exact figure from the books, rupees to 2 decimals. */
  exactRupees: number;
  /** Figure on the filed return, rounded per Section 170. */
  filedRupees: number;
  /** filed − exact. */
  deltaRupees: number;
}

/** Every tax figure where the filed return differs from the exact books figure (internal report only). */
export function taxDeltas(exact: unknown, filed: unknown, path = ""): TaxDelta[] {
  if (Array.isArray(exact) && Array.isArray(filed)) {
    return exact.flatMap((x, i) => taxDeltas(x, filed[i], `${path}[${i}]`));
  }
  if (!exact || typeof exact !== "object" || !filed || typeof filed !== "object") return [];
  const out: TaxDelta[] = [];
  for (const [k, v] of Object.entries(exact as Record<string, unknown>)) {
    const f = (filed as Record<string, unknown>)[k];
    const p = path ? `${path}.${k}` : k;
    if (TAX_KEYS.has(k) && typeof v === "number" && typeof f === "number") {
      if (Math.abs(f - v) > 1e-9) out.push({ path: p, exactRupees: v, filedRupees: f, deltaRupees: f - v });
    } else {
      out.push(...taxDeltas(v, f, p));
    }
  }
  return out;
}
