import { describe, expect, it } from "vitest";
import { calculateCost, type ItemMove } from "@/lib/inventory/valuation-engine";

const mv = (date: string, type: string, qty: number, taxablePaise: number): ItemMove => ({
  date,
  qty,
  taxablePaise,
  type,
  voucherId: `${type}-${date}`,
});

// Reported case (TORQ ULTRA CS 220 BLUE): quantity is still negative after a
// purchase, but the stock was showing a positive value. A negative quantity
// must always carry a negative (or zero) value.
describe("negative quantity keeps a negative value", () => {
  const moves = [
    mv("2026-01-05", "sales", 150, 0),         // opening 100 @100 -> -50 units
    mv("2026-01-10", "purchase", 20, 20000),   // 20 @1000, still short -> -30 units
  ];

  it("average: still short after a purchase -> value is quantity times the average", () => {
    const r = calculateCost("average", 100, 100, moves);
    expect(r.closingQty).toBe(-30);
    expect(r.closingValuePaise).toBe(-3000);
  });

  it("average: a purchase that is still short never adds value to a negative quantity", () => {
    const r = calculateCost("average", 0, 0, [
      mv("2026-01-01", "purchase", 100, 10000),
      mv("2026-01-02", "sales", 150, 0),
      mv("2026-01-03", "purchase", 10, 100000),
    ]);
    expect(r.closingQty).toBe(-40);
    expect(r.closingValuePaise).toBe(-4000);
  });

  it("FIFO: negative quantity is valued at a negative amount, not a positive one", () => {
    const r = calculateCost("fifo", 100, 100, moves);
    expect(r.closingQty).toBe(-30);
    expect(r.closingValuePaise).toBe(-3000);
  });

  it("LIFO: negative quantity is valued at a negative amount, not a positive one", () => {
    const r = calculateCost("lifo", 100, 100, moves);
    expect(r.closingQty).toBe(-30);
    expect(r.closingValuePaise).toBe(-3000);
  });
});
