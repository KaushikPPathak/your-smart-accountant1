import { describe, expect, it } from "vitest";
import { calculateWac, type ItemMove } from "@/lib/inventory/valuation-engine";

// The stock summary opens a window with the stock held the day before `from`. For an item the book
// opened with 100 kg (stored opening, last year's start) and then moved in and out across both years,
// the 2026-27 window must open with last year's closing, and opening + in - out must reconcile to closing.
const stored = { qty: 100, rate: 1000 };
const mv = (date: string, qty: number, type: string): ItemMove => ({ date, qty, type, taxablePaise: 0, voucherId: date });
const moves: ItemMove[] = [
  mv("2025-06-10", 40, "purchase"),
  mv("2026-02-10", -30, "sales"),
  mv("2026-05-05", 20, "purchase"),
  mv("2026-06-01", -25, "sales"),
];

describe("stock summary opening for a financial-year window", () => {
  it("opens 2026-27 with last year's closing, not the stored opening", () => {
    const from = "2026-04-01";
    const to = "2027-03-31";
    const opening = calculateWac(stored.qty, stored.rate, moves.filter((m) => m.date < from), "average").closingQty;
    expect(opening).toBe(100 + 40 - 30);
    expect(opening).not.toBe(stored.qty);
  });

  it("reconciles opening + in - out to closing", () => {
    const from = "2026-04-01";
    const to = "2027-03-31";
    const opening = calculateWac(stored.qty, stored.rate, moves.filter((m) => m.date < from), "average").closingQty;
    const inWin = moves.filter((m) => m.date >= from && m.date <= to && m.qty > 0).reduce((s, m) => s + m.qty, 0);
    const outWin = moves.filter((m) => m.date >= from && m.date <= to && m.qty < 0).reduce((s, m) => s - m.qty, 0);
    const closing = calculateWac(stored.qty, stored.rate, moves.filter((m) => m.date <= to), "average").closingQty;
    expect(opening + inWin - outWin).toBe(closing);
  });
});
