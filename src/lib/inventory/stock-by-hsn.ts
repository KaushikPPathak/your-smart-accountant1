// HSN-wise compact stock summary.
//
// Turnover rule (CBIC Notification 78/2020-CT, same as GSTR-1 validation):
//   aggregate turnover up to ₹5 crore → 4-digit HSN; above ₹5 crore → 6-digit HSN.
// Items are grouped by their HSN truncated to that length, so an 8-digit code
// on an item rolls up into its 4- or 6-digit heading.

/** ₹5 crore in paise (5,00,00,000 rupees × 100). */
export const HSN_6DIGIT_THRESHOLD_PAISE = 5_00_00_000 * 100;

export function hsnDigitsForTurnover(turnoverPaise: number): 4 | 6 {
  return turnoverPaise > HSN_6DIGIT_THRESHOLD_PAISE ? 6 : 4;
}

export interface StockLineForHsn {
  id: string;
  name: string;
  hsn_code: string | null;
  unit: string;
  opening: number;
  inWindow: number;
  outWindow: number;
  closing: number;
  stockValue: number;
}

export interface HsnStockGroup extends StockLineForHsn {
  itemCount: number;
  /** Set when the items in the group use different units; quantities then add up across units. */
  mixedUnits: boolean;
}

/** Truncates an HSN code to the reporting length. Empty for a missing code. */
export function hsnGroupKey(code: string | null | undefined, digits: 4 | 6): string {
  const d = String(code ?? "").replace(/\D/g, "");
  return d.slice(0, digits);
}

/**
 * Sums opening, inward, outward, closing quantity and value per HSN group.
 * Negative quantities and negative values are summed as they are, so a
 * group's value can be negative. Groups are sorted by HSN; items with no HSN
 * come last.
 */
export function groupStockByHsn(rows: StockLineForHsn[], digits: 4 | 6): HsnStockGroup[] {
  const map = new Map<string, HsnStockGroup & { _units: Set<string> }>();
  for (const r of rows) {
    const key = hsnGroupKey(r.hsn_code, digits);
    let g = map.get(key);
    if (!g) {
      g = {
        id: `hsn:${key || "none"}`,
        name: key ? `HSN ${key}` : "No HSN",
        hsn_code: key || null,
        unit: "",
        opening: 0,
        inWindow: 0,
        outWindow: 0,
        closing: 0,
        stockValue: 0,
        itemCount: 0,
        mixedUnits: false,
        _units: new Set<string>(),
      };
      map.set(key, g);
    }
    g.opening += r.opening;
    g.inWindow += r.inWindow;
    g.outWindow += r.outWindow;
    g.closing += r.closing;
    g.stockValue += r.stockValue;
    g.itemCount += 1;
    g._units.add(r.unit);
  }
  const out = [...map.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([, g]) => {
      const { _units, ...rest } = g;
      const units = [..._units];
      return {
        ...rest,
        unit: units.length === 1 ? units[0] : "Mixed",
        mixedUnits: units.length > 1,
        opening: round6(g.opening),
        inWindow: round6(g.inWindow),
        outWindow: round6(g.outWindow),
        closing: round6(g.closing),
      };
    });
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
