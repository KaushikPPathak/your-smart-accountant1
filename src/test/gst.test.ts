import { describe, it, expect } from "vitest";
import { computeLine, sumLines, isInterstate } from "@/lib/gst";

describe("computeLine (GST calculation)", () => {
  it("intra-state 18% splits CGST=SGST=9%", () => {
    const r = computeLine({ qty: 1, rate: 100, discount: 0, gstRate: 18 }, false);
    expect(r.taxable_paise).toBe(10000);
    expect(r.cgst_paise).toBe(900);
    expect(r.sgst_paise).toBe(900);
    expect(r.igst_paise).toBe(0);
    expect(r.total_paise).toBe(11800);
    expect(r.rounding_paise).toBe(0);
  });

  it("inter-state 18% is all IGST", () => {
    const r = computeLine({ qty: 2, rate: 250, discount: 0, gstRate: 18 }, true);
    expect(r.taxable_paise).toBe(50000);
    expect(r.igst_paise).toBe(9000);
    expect(r.cgst_paise).toBe(0);
    expect(r.sgst_paise).toBe(0);
    expect(r.total_paise).toBe(59000);
  });

  it("odd-paise GST splits with rounding remainder ≤ 1 paise", () => {
    // 12% of 15 paise taxable = 1.8 → round to 2 paise, split → cgst=1, sgst=1
    const r = computeLine({ qty: 1, rate: 0.15, discount: 0, gstRate: 12 }, false);
    expect(r.taxable_paise).toBe(15);
    expect(r.cgst_paise + r.sgst_paise + r.rounding_paise).toBe(Math.round(15 * 0.12));
    expect(r.cgst_paise).toBe(r.sgst_paise); // law requires exact equality
    expect(r.rounding_paise).toBeLessThanOrEqual(1);
    expect(r.total_paise).toBe(r.taxable_paise + r.cgst_paise + r.sgst_paise + r.rounding_paise);
  });

  it("discount reduces taxable before GST", () => {
    const r = computeLine({ qty: 1, rate: 200, discount: 50, gstRate: 18 }, false);
    expect(r.taxable_paise).toBe(15000);
    expect(r.cgst_paise + r.sgst_paise).toBe(2700);
  });

  it("discount > amount clamps taxable to zero", () => {
    const r = computeLine({ qty: 1, rate: 100, discount: 500, gstRate: 18 }, false);
    expect(r.taxable_paise).toBe(0);
    expect(r.total_paise).toBe(0);
  });

  it("0% GST returns zero tax", () => {
    const r = computeLine({ qty: 5, rate: 100, discount: 0, gstRate: 0 }, false);
    expect(r.cgst_paise).toBe(0);
    expect(r.sgst_paise).toBe(0);
    expect(r.igst_paise).toBe(0);
    expect(r.total_paise).toBe(50000);
  });

  it("28% cess-tier at high volume", () => {
    const r = computeLine({ qty: 10, rate: 1000, discount: 0, gstRate: 28 }, true);
    expect(r.taxable_paise).toBe(1_000_000);
    expect(r.igst_paise).toBe(280_000);
    expect(r.total_paise).toBe(1_280_000);
  });
});

describe("sumLines", () => {
  it("aggregates a multi-line invoice correctly", () => {
    const lines = [
      computeLine({ qty: 2, rate: 500, discount: 0, gstRate: 18 }, false),
      computeLine({ qty: 1, rate: 300, discount: 30, gstRate: 12 }, false),
    ];
    const t = sumLines(lines);
    expect(t.subtotal_paise).toBe(lines[0].taxable_paise + lines[1].taxable_paise);
    expect(t.cgst_paise).toBe(lines[0].cgst_paise + lines[1].cgst_paise);
    expect(t.sgst_paise).toBe(lines[0].sgst_paise + lines[1].sgst_paise);
    expect(t.total_paise).toBe(lines[0].total_paise + lines[1].total_paise);
    // Cross-check: total = subtotal + cgst + sgst + igst + rounding
    expect(t.total_paise).toBe(t.subtotal_paise + t.cgst_paise + t.sgst_paise + t.igst_paise + t.rounding_paise);
  });

  it("empty lines produce zeros", () => {
    const t = sumLines([]);
    expect(t.total_paise).toBe(0);
    expect(t.subtotal_paise).toBe(0);
  });
});

describe("isInterstate", () => {
  it("returns true for different state codes", () => {
    expect(isInterstate("27", "29")).toBe(true);
  });
  it("returns false for identical state codes", () => {
    expect(isInterstate("27", "27")).toBe(false);
  });
  it("returns false when either code is missing (safer default: intra-state)", () => {
    expect(isInterstate(null, "27")).toBe(false);
    expect(isInterstate("27", undefined)).toBe(false);
    expect(isInterstate("", "27")).toBe(false);
  });
});
