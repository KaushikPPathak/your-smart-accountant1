import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, countVarianceNeedsReason } from "@/lib/policy-settings";

describe("count variance rule (5.4)", () => {
  it("uses the ₹500 floor on a small line", () => {
    expect(countVarianceNeedsReason(40_000, 100_000, DEFAULT_POLICY)).toBe(false); // ₹400 on ₹1,000
    expect(countVarianceNeedsReason(60_000, 100_000, DEFAULT_POLICY)).toBe(true); // ₹600 on ₹1,000
  });
  it("uses 1% of the line value when the line is large", () => {
    // ₹2,000 on ₹10 lakh: 1% is ₹10,000, so the floor of ₹500 is not the limit
    expect(countVarianceNeedsReason(200_000, 100_000_000, DEFAULT_POLICY)).toBe(false);
    expect(countVarianceNeedsReason(1_100_000, 100_000_000, DEFAULT_POLICY)).toBe(true); // ₹11,000
  });
  it("treats a shortage the same as a surplus", () => {
    expect(countVarianceNeedsReason(-60_000, 100_000, DEFAULT_POLICY)).toBe(true);
  });
});
