import { describe, expect, it } from "vitest";
import { tryParseToPaise } from "@/lib/utils/currency-utils";

describe("tryParseToPaise", () => {
  it("parses ordinary amounts to paise", () => {
    expect(tryParseToPaise("1234.5")).toBe(123450);
    expect(tryParseToPaise("1,234.56")).toBe(123456);
    expect(tryParseToPaise("7")).toBe(700);
    expect(tryParseToPaise(1.5)).toBe(150);
  });

  it("accepts Indian grouping, a currency prefix, and a leading minus", () => {
    expect(tryParseToPaise("₹1,20,000")).toBe(12000000);
    expect(tryParseToPaise("Rs. 250.10")).toBe(25010);
    expect(tryParseToPaise("-12.00")).toBe(-1200);
  });

  it("rejects malformed text instead of coercing it", () => {
    expect(tryParseToPaise("1.2.3")).toBeNull();
    expect(tryParseToPaise("12-3")).toBeNull();
    expect(tryParseToPaise("1.234")).toBeNull();
    expect(tryParseToPaise("1,20.5x")).toBeNull();
    expect(tryParseToPaise("abc")).toBeNull();
    expect(tryParseToPaise("")).toBeNull();
    expect(tryParseToPaise(null)).toBeNull();
    expect(tryParseToPaise(Number.NaN)).toBeNull();
  });
});
