import { describe, expect, it } from "vitest";
import { companyFeatures, isUrlEnabled } from "@/lib/company-features";
import { RECEIPT_TDS_SECTIONS, splitTds, tdsSection } from "@/lib/tax/tds";

const business = { gst_registered: true, gstin: "24ABCDE1234F1Z5", inventory_enabled: true, presumptive_scheme: "44ad" };

describe("company type: income from other sources only", () => {
  it("a normal company keeps its business menus", () => {
    const f = companyFeatures({ ...business, income_only: false });
    expect(f.incomeOnly).toBe(false);
    expect(f.gst && f.inventory && f.presumptive).toBe(true);
    expect(isUrlEnabled("/app/vouchers/new/sales", f)).toBe(true);
    expect(isUrlEnabled("/app/items", f)).toBe(true);
    expect(isUrlEnabled("/app/reports/gstr1", f)).toBe(true);
  });

  it("income-only hides business menus, GST, stock and presumptive even when those were set", () => {
    const f = companyFeatures({ ...business, income_only: true });
    expect(f.incomeOnly).toBe(true);
    expect(f.gst).toBe(false);
    expect(f.inventory).toBe(false);
    expect(f.presumptive).toBe(false);
    for (const url of [
      "/app/vouchers/new/sales",
      "/app/vouchers/new/purchase",
      "/app/vouchers/new/sales_order",
      "/app/items",
      "/app/reports/stock-summary",
      "/app/reports/hsn-summary",
      "/app/reports/gstr1",
      "/app/reports/itc-party-wise",
      "/app/reports/presumptive",
    ]) {
      expect(isUrlEnabled(url, f), url).toBe(false);
    }
  });

  it("income-only keeps receipts, payments, journals, ledgers and reports", () => {
    const f = companyFeatures({ income_only: true });
    for (const url of [
      "/app/vouchers/new/receipt",
      "/app/vouchers/new/payment",
      "/app/vouchers/new/journal",
      "/app/ledgers",
      "/app/reports/day-book",
      "/app/reports/trial-balance",
      "/app/reports/profit-loss",
      "/app/reports/balance-sheet",
      "/app/reports/receipts-payments",
    ]) {
      expect(isUrlEnabled(url, f), url).toBe(true);
    }
  });
});

describe("TDS deducted by the payer on a receipt", () => {
  it("interest, dividend and rent sections are available for receipts", () => {
    expect(RECEIPT_TDS_SECTIONS.map((s) => s.code)).toEqual(["194A", "194", "194I"]);
    expect(tdsSection("194A")?.defaultRatePercent).toBe(10);
  });

  it("on a receipt of ₹50,000 interest at 10%: bank receives ₹45,000 and TDS receivable is ₹5,000", () => {
    const s = splitTds(5_000_000, 10);
    expect(s.tdsPaise).toBe(500_000);
    expect(s.bankCreditPaise).toBe(4_500_000);
    expect(s.bankCreditPaise + s.tdsPaise).toBe(5_000_000);
  });
});
