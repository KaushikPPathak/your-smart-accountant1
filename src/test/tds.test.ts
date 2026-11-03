import { describe, expect, it } from "vitest";
import { splitTds, tdsAmountPaise, tdsNarration, tdsRateError, tdsSection } from "@/lib/tax/tds";

describe("TDS on payment vouchers", () => {
  it("194J at 10% on ₹1,00,000 deducts ₹10,000 and credits the bank with ₹90,000", () => {
    const s = splitTds(10_000_000, 10);
    expect(s.tdsPaise).toBe(1_000_000);
    expect(s.bankCreditPaise).toBe(9_000_000);
    expect(s.bankCreditPaise + s.tdsPaise).toBe(10_000_000);
  });

  it("194Q at 0.1% rounds to the nearest paisa", () => {
    expect(tdsAmountPaise(12_345_678, 0.1)).toBe(12_346);
  });

  it("zero, negative and invalid inputs give no deduction", () => {
    expect(tdsAmountPaise(0, 10)).toBe(0);
    expect(tdsAmountPaise(10_000, 0)).toBe(0);
    expect(tdsAmountPaise(10_000, -2)).toBe(0);
    expect(tdsAmountPaise(10_000, Number.NaN)).toBe(0);
  });

  it("the deduction never exceeds the gross payment", () => {
    const s = splitTds(5_000, 500);
    expect(s.tdsPaise).toBe(5_000);
    expect(s.bankCreditPaise).toBe(0);
  });

  it("every section has a default rate and a readable label", () => {
    expect(tdsSection("194C")?.defaultRatePercent).toBe(2);
    expect(tdsSection("194J")?.defaultRatePercent).toBe(10);
    expect(tdsSection("194Q")?.defaultRatePercent).toBe(0.1);
    expect(tdsSection("999")).toBeUndefined();
  });

  it("narration names the section and rate", () => {
    expect(tdsNarration("194J", 10)).toBe("TDS 194J @ 10%");
  });

  it("rate validation", () => {
    expect(tdsRateError(10)).toBeNull();
    expect(tdsRateError(0)).not.toBeNull();
    expect(tdsRateError(45)).not.toBeNull();
    expect(tdsRateError(Number.NaN)).not.toBeNull();
  });
});
