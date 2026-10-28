// Regression tests for the 2026-10-27 code review.
import { describe, expect, it } from "vitest";
import {
  parseToPaise,
  calculateGST,
  roundToNearestRupee,
  amountInWords,
} from "@/lib/utils/currency-utils";

describe("review 2026-10-27: money helpers", () => {
  it("parses exponent notation instead of mangling it", () => {
    expect(parseToPaise("1.5e3")).toBe(150000); // was 153 before the fix
    expect(parseToPaise("2E2")).toBe(20000);
  });

  it("keeps ordinary rupee strings exact", () => {
    expect(parseToPaise("1,234.56")).toBe(123456);
    expect(parseToPaise("-0.5")).toBe(-50);
    expect(parseToPaise("1234.5")).toBe(123450);
  });

  it("rounds negative halves away from zero for GST", () => {
    expect(calculateGST(1, 50)).toBe(1);     // 0.5 -> 1
    expect(calculateGST(-1, 50)).toBe(-1);   // -0.5 -> -1 (Math.round gave 0)
    expect(calculateGST(-100, 18)).toBe(-18);
  });

  it("rounds to the nearest rupee symmetrically", () => {
    expect(roundToNearestRupee(150)).toBe(200);
    expect(roundToNearestRupee(-150)).toBe(-200);
  });

  it("spells negative amounts in words", () => {
    expect(amountInWords(-100)).toBe("Minus Rupees One Only");
  });
});
