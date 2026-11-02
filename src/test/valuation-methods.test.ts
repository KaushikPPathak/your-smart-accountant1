import { describe, expect, it } from "vitest";
import { calculateCost, calculateWac, type ItemMove } from "@/lib/inventory/valuation-engine";
import { normaliseValuationMethod } from "@/lib/inventory/valuation-method";

const mv = (date: string, type: string, qty: number, taxablePaise: number): ItemMove => ({
  date,
  qty,
  taxablePaise,
  type,
  voucherId: `${type}-${date}`,
});

describe("negative stock that comes back above zero", () => {
  // Reported case (LUB/OIL-2L): stock went negative after a sale, then a
  // purchase at a much lower rate brought it back. The old engine kept the
  // negative cost, so 150 units showed a negative value.
  it("values the stock on hand at the purchase rate, never a negative value", () => {
    const moves = [
      mv("2026-01-01", "purchase", 100, 10000), // 100 @ 100
      mv("2026-01-05", "sales", 150, 0),        // sells 150 at WAC 100 -> -50 units
      mv("2026-01-10", "purchase", 200, 2000),  // 200 @ 10
    ];
    const r = calculateWac(0, 0, moves);
    expect(r.closingQty).toBe(150);
    expect(r.closingValuePaise).toBe(1500);
    expect(r.wacPaise).toBe(10);
    expect(r.needsReview).toBe(false);
  });

  it("a zero-value purchase after stock is sold out gives quantity with zero value, not a negative one", () => {
    const moves = [
      mv("2026-01-01", "purchase", 100, 10000),
      mv("2026-01-02", "sales", 100, 0),
      mv("2026-01-03", "purchase", 50, 0), // zero-value purchase
    ];
    const r = calculateWac(0, 0, moves);
    expect(r.closingQty).toBe(50);
    expect(r.closingValuePaise).toBe(0);
    expect(r.needsReview).toBe(false);
  });

  it("keeps negative stock valued as before while it is still negative", () => {
    const r = calculateWac(100, 100, [mv("2026-01-02", "sales", 150, 0)]);
    expect(r.closingQty).toBe(-50);
    expect(r.closingValuePaise).toBe(-5000);
  });
});

describe("costing methods on the same movements", () => {
  // Purchases: 100 @ 100 then 100 @ 200. Sale of 150 leaves 50 units.
  const moves = [
    mv("2026-01-01", "purchase", 100, 10000),
    mv("2026-01-02", "purchase", 100, 20000),
    mv("2026-01-03", "sales", 150, 0),
  ];

  it("average cost values the 50 units left at the running average (150)", () => {
    const r = calculateCost("average", 0, 0, moves);
    expect(r.closingQty).toBe(50);
    expect(r.closingValuePaise).toBe(7500);
  });

  it("FIFO sells the oldest first, so the 50 units left are the newest (200)", () => {
    const r = calculateCost("fifo", 0, 0, moves);
    expect(r.closingQty).toBe(50);
    expect(r.closingValuePaise).toBe(10000);
  });

  it("LIFO sells the newest first, so the 50 units left are the oldest (100)", () => {
    const r = calculateCost("lifo", 0, 0, moves);
    expect(r.closingQty).toBe(50);
    expect(r.closingValuePaise).toBe(5000);
  });

  it("all methods agree on the quantity", () => {
    const q = (m: "average" | "fifo" | "lifo") => calculateCost(m, 0, 0, moves).closingQty;
    expect(q("average")).toBe(q("fifo"));
    expect(q("fifo")).toBe(q("lifo"));
  });

  it("FIFO and LIFO use opening stock as the first layer", () => {
    const opening = [mv("2026-01-05", "sales", 30, 0)];
    expect(calculateCost("fifo", 100, 50, opening).closingValuePaise).toBe(3500); // 70 @ 50
    expect(calculateCost("lifo", 100, 50, opening).closingValuePaise).toBe(3500);
  });

  it("FIFO/LIFO sales beyond stock cost nothing and are covered by later purchases", () => {
    const m = [
      mv("2026-01-01", "sales", 10, 0),
      mv("2026-01-02", "purchase", 25, 2500), // 25 @ 100, first 10 cover the shortfall
    ];
    const r = calculateCost("fifo", 0, 0, m);
    expect(r.closingQty).toBe(15);
    expect(r.closingValuePaise).toBe(1500);
  });
});

describe("float dust", () => {
  it("does not show a tiny leftover quantity or value after stock is fully sold", () => {
    const moves = [
      mv("2026-01-01", "purchase", 0.1, 10),
      mv("2026-01-02", "purchase", 0.2, 20),
      mv("2026-01-03", "sales", 0.3, 0),
    ];
    for (const method of ["average", "fifo", "lifo"] as const) {
      const r = calculateCost(method, 0, 0, moves);
      expect(r.closingQty).toBe(0);
      expect(r.closingValuePaise).toBe(0);
    }
  });
});

describe("valuation method setting", () => {
  it("defaults to average cost for anything unknown", () => {
    expect(normaliseValuationMethod(undefined)).toBe("average");
    expect(normaliseValuationMethod("weird")).toBe("average");
    expect(normaliseValuationMethod("FIFO")).toBe("fifo");
    expect(normaliseValuationMethod("lifo")).toBe("lifo");
  });
});
