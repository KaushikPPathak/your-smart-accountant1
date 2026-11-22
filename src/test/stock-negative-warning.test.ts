import { describe, expect, it } from "vitest";
import { itemsGoingNegative, stockSignFor } from "@/lib/stock-negative-warning";

describe("negative stock warning", () => {
  it("signs stock movements by voucher type", () => {
    expect(stockSignFor("sales")).toBe(-1);
    expect(stockSignFor("purchase")).toBe(1);
    expect(stockSignFor("journal")).toBe(0);
  });

  it("warns when a sale takes an item below zero, with the closing quantity", () => {
    const out = itemsGoingNegative({
      opening: new Map([["A", 5]]),
      netBefore: new Map([["A", -2]]),
      thisVoucher: new Map([["A", { name: "Silver coin", qty: -4 }]]),
    });
    expect(out).toEqual([{ itemId: "A", name: "Silver coin", closing: -1 }]);
  });

  it("does not warn when stock stays at zero or above", () => {
    expect(itemsGoingNegative({
      opening: new Map([["A", 5]]), netBefore: new Map(),
      thisVoucher: new Map([["A", { name: "x", qty: -5 }]]),
    })).toEqual([]);
  });

  it("does not warn for a purchase that adds stock", () => {
    expect(itemsGoingNegative({
      opening: new Map([["A", -3]]), netBefore: new Map(),
      thisVoucher: new Map([["A", { name: "x", qty: 10 }]]),
    })).toEqual([]);
  });
});
