import { describe, expect, it } from "vitest";
import { groupStockByHsn, hsnDigitsForTurnover, hsnGroupKey } from "@/lib/inventory/stock-by-hsn";

const row = (id: string, hsn: string | null, o: number, i: number, out: number, c: number, v: number, unit = "Ltr") => ({
  id, name: id, hsn_code: hsn, unit, opening: o, inWindow: i, outWindow: out, closing: c, stockValue: v,
});

describe("HSN digits by turnover", () => {
  it("4 digits up to ₹5 crore, 6 digits above it", () => {
    expect(hsnDigitsForTurnover(0)).toBe(4);
    expect(hsnDigitsForTurnover(5_00_00_000 * 100)).toBe(4);
    expect(hsnDigitsForTurnover(5_00_00_000 * 100 + 1)).toBe(6);
    expect(hsnDigitsForTurnover(12_00_00_000 * 100)).toBe(6);
  });
});

describe("HSN key", () => {
  it("truncates 8-digit codes and drops spaces", () => {
    expect(hsnGroupKey("27101980", 4)).toBe("2710");
    expect(hsnGroupKey("27101980", 6)).toBe("271019");
    expect(hsnGroupKey(" 2710 ", 6)).toBe("2710");
    expect(hsnGroupKey(null, 4)).toBe("");
  });
});

describe("groupStockByHsn", () => {
  it("sums movement and value per 4-digit heading and keeps negative values negative", () => {
    const rows = [
      row("LUB", "27101980", 0, 6649, 6397.8, 252.2, -1107491.12),
      row("GEAR", "27101990", 40, 0, 40, 0, 0),
      row("MAT", "34031900", 10, 5, 0, 15, 1500),
    ];
    const g = groupStockByHsn(rows, 4);
    expect(g.map((x) => x.hsn_code)).toEqual(["2710", "3403"]);
    const oil = g[0];
    expect(oil.itemCount).toBe(2);
    expect(oil.opening).toBe(40);
    expect(oil.inWindow).toBe(6649);
    expect(oil.outWindow).toBe(6437.8);
    expect(oil.closing).toBe(252.2);
    expect(oil.stockValue).toBe(-1107491.12);
  });

  it("groups by 6 digits when the turnover rule needs it", () => {
    // 271019 80 and 271019 90 are different 8-digit codes but share a 6-digit heading.
    const rows = [row("A", "27101980", 0, 1, 0, 1, 10), row("B", "27101990", 0, 1, 0, 1, 10), row("C", "27101100", 0, 0, 0, 0, 0)];
    const g = groupStockByHsn(rows, 6);
    expect(g.map((x) => x.hsn_code)).toEqual(["271011", "271019"]);
    expect(g[1].itemCount).toBe(2);
    expect(g[1].closing).toBe(2);
  });

  it("puts items without an HSN last and marks mixed units", () => {
    const rows = [
      row("NOHSN", null, 0, 0, 0, 2, 200, "Ltr"),
      row("X", "2710", 0, 1, 0, 1, 100, "Ltr"),
      row("Y", "2710", 0, 1, 0, 1, 100, "Kgs"),
    ];
    const g = groupStockByHsn(rows, 4);
    expect(g.map((x) => x.name)).toEqual(["HSN 2710", "No HSN"]);
    expect(g[0].unit).toBe("Mixed");
    expect(g[0].mixedUnits).toBe(true);
    expect(g[1].unit).toBe("Ltr");
  });
});
