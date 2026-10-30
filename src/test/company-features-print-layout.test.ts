import { describe, expect, it } from "vitest";
import { companyFeatures, isUrlEnabled } from "@/lib/company-features";
import { groupBookRowsByDate } from "@/lib/print-layout";

describe("per-company feature switches", () => {
  it("hides presumptive tax unless the company chose 44AD or 44ADA", () => {
    expect(isUrlEnabled("/app/reports/presumptive", companyFeatures({ presumptive_scheme: "none" }))).toBe(false);
    expect(isUrlEnabled("/app/reports/presumptive", companyFeatures({}))).toBe(false);
    expect(isUrlEnabled("/app/reports/presumptive", companyFeatures({ presumptive_scheme: "44ad" }))).toBe(true);
    expect(companyFeatures({ presumptive_scheme: "44ada" }).presumptive).toBe(true);
  });

  it("hides GSTR-9 for a company that is not GST registered", () => {
    expect(isUrlEnabled("/app/reports/gstr9", companyFeatures({ gst_registered: false }))).toBe(false);
    expect(isUrlEnabled("/app/reports/gstr9", companyFeatures({ gst_registered: true }))).toBe(true);
  });

  it("hides stock pages when the company does not keep inventory", () => {
    expect(isUrlEnabled("/app/reports/stock-summary", companyFeatures({ inventory_enabled: false }))).toBe(false);
    expect(isUrlEnabled("/app/reports/stock-summary", companyFeatures({ inventory_enabled: true }))).toBe(true);
  });
});

describe("date-wise book printing", () => {
  const row = (key: string, date: string, debit: number, credit: number, balance: number) =>
    ({ key, date, vchNo: key, vchType: "Receipt", particulars: "", narration: "", debit, credit, balance });

  it("starts one block per date and carries the balance forward", () => {
    const days = groupBookRowsByDate([
      row("a", "2025-06-01", 1000, 0, 6000),
      row("b", "2025-06-01", 0, 500, 5500),
      row("c", "2025-06-02", 200, 0, 5700),
    ], 5000);
    expect(days.map((d) => d.date)).toEqual(["2025-06-01", "2025-06-02"]);
    expect(days[0]).toMatchObject({ opening: 5000, closing: 5500, debit: 1000, credit: 500 });
    expect(days[1]).toMatchObject({ opening: 5500, closing: 5700, debit: 200, credit: 0 });
  });
});
