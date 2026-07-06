import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/currency", () => ({ getCurrentCurrencySymbol: () => "₹" }));

import { rupeesToPaise, paiseToRupees, formatINR, amountInWords } from "@/lib/money";

describe("rupeesToPaise", () => {
  it("rounds to nearest paise", () => {
    expect(rupeesToPaise(100)).toBe(10_000);
    expect(rupeesToPaise(99.995)).toBe(10_000);
    expect(rupeesToPaise(99.994)).toBe(9_999);
    expect(rupeesToPaise("12.34")).toBe(1_234);
  });
  it("returns 0 for invalid input", () => {
    expect(rupeesToPaise("abc")).toBe(0);
    expect(rupeesToPaise(Number.NaN)).toBe(0);
    expect(rupeesToPaise(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("handles negatives", () => {
    expect(rupeesToPaise(-1.5)).toBe(-150);
  });
});

describe("paiseToRupees", () => {
  it("divides by 100", () => {
    expect(paiseToRupees(12345)).toBe(123.45);
  });
});

describe("formatINR (Indian grouping)", () => {
  it("groups lakhs and crores", () => {
    expect(formatINR(1_23_45_67_89, { symbol: false })).toBe("12,34,567.89");
    // ₹1,23,45,67,890.12 → 12345678901200 paise? Use a definite crore value.
    expect(formatINR(1234567890012, { symbol: false })).toBe("12,34,56,78,900.12");
  });

  it("handles negatives with sign before symbol", () => {
    expect(formatINR(-10000, { symbol: false })).toBe("-100.00");
  });
  it("always shows two decimals", () => {
    expect(formatINR(100, { symbol: false })).toBe("1.00");
  });
});

describe("amountInWords (Indian rupees)", () => {
  it("zero", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
  it("basic rupees", () => {
    expect(amountInWords(12300)).toBe("Rupees One Hundred Twenty Three Only");
  });
  it("thousands and lakhs", () => {
    expect(amountInWords(1_23_000_00)).toContain("One Lakh Twenty Three Thousand");
  });
  it("crores", () => {
    expect(amountInWords(2_00_00_000_00)).toContain("Two Crore");
  });
  it("includes paise remainder", () => {
    expect(amountInWords(10050)).toBe("Rupees One Hundred and Fifty Paise Only");
  });
});
