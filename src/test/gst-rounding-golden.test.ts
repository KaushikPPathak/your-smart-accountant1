// Golden GST line cases. Every expected value is worked out by hand from the rule
// in the comment, not copied from the code. Amounts are in paise.
import { describe, expect, it } from "vitest";
import { computeLine } from "@/lib/gst";

describe("GST line rounding (hand-worked)", () => {
  it("3 × ₹33.33 at 18% intra-state: taxable 9999, tax 1799.82 → 1800, CGST 900 + SGST 900", () => {
    // 9999 × 18 / 100 = 1799.82 → half-up 1800. Even, so no rounding paisa.
    const r = computeLine({ qty: 3, rate: 33.33, discount: 0, gstRate: 18 }, false);
    expect(r.taxable_paise).toBe(9999);
    expect(r.cgst_paise + r.sgst_paise).toBe(1800);
    expect(r.cgst_paise).toBe(900);
    expect(r.rounding_paise).toBe(0);
    expect(r.total_paise).toBe(11799);
  });

  it("taxable 10003 at 18% intra-state: tax 1800.54 → 1801, so CGST 900 + SGST 900 + 1 paisa round-off", () => {
    // 10003 × 18 / 100 = 1800.54 → 1801. Odd, so one paisa goes to rounding.
    const r = computeLine({ qty: 1, rate: 100.03, discount: 0, gstRate: 18 }, false);
    expect(r.taxable_paise).toBe(10003);
    expect(r.cgst_paise).toBe(900);
    expect(r.sgst_paise).toBe(900);
    expect(r.rounding_paise).toBe(1);
    expect(r.total_paise).toBe(11804);
  });

  it("inter-state 5% on 1234.57: tax 6172.85 → 6173 as IGST, total 129630", () => {
    const r = computeLine({ qty: 1, rate: 1234.57, discount: 0, gstRate: 5 }, true);
    expect(r.taxable_paise).toBe(123457);
    expect(r.igst_paise).toBe(6173);
    expect(r.cgst_paise + r.sgst_paise).toBe(0);
    expect(r.total_paise).toBe(129630);
  });

  it("discount of ₹0.01 comes off before tax: 2 × ₹99.99 − ₹0.01 = 19997, 12% → 2400", () => {
    // 19997 × 12 / 100 = 2399.64 → 2400.
    const r = computeLine({ qty: 2, rate: 99.99, discount: 0.01, gstRate: 12 }, false);
    expect(r.taxable_paise).toBe(19997);
    expect(r.cgst_paise + r.sgst_paise).toBe(2400);
    expect(r.total_paise).toBe(22397);
  });

  it("a line with GST not charged has zero tax and keeps its taxable value", () => {
    const r = computeLine({ qty: 1, rate: 500, discount: 0, gstRate: 18, chargeGst: false }, false);
    expect(r.cgst_paise + r.sgst_paise + r.igst_paise).toBe(0);
    expect(r.total_paise).toBe(50000);
  });
});
