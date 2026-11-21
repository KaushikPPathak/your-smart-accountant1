import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { fyQuarterFor, runReturnsSummary } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 4.5: sales and purchase returns this quarter, with reasons. Paise throughout.
const CO = "co-returns";
const Q3 = { from: "2026-10-01", to: "2026-12-31" };

describe("routing: returns", () => {
  it("routes the questionnaire wording to returns_summary", () => {
    expect(routeQuery("What is our total purchase return or sales return value this quarter, and why did it occur?").intent).toBe(
      "returns_summary",
    );
  });

  it("keeps the vendor debit note question on vendor_overdue", () => {
    expect(routeQuery("Which vendors have overdue balances or unadjusted debit notes/advances?").intent).toBe("vendor_overdue");
  });
});

describe("financial-year quarter", () => {
  it("finds the quarter containing a date (April start)", () => {
    expect(fyQuarterFor(new Date(2026, 10, 21))).toEqual({ from: "2026-10-01", to: "2026-12-31", label: "Q3 FY2026-27" });
    expect(fyQuarterFor(new Date(2027, 0, 15))).toEqual({ from: "2027-01-01", to: "2027-03-31", label: "Q4 FY2026-27" });
    expect(fyQuarterFor(new Date(2026, 3, 1))).toEqual({ from: "2026-04-01", to: "2026-06-30", label: "Q1 FY2026-27" });
    expect(fyQuarterFor(new Date(2026, 6, 31))).toEqual({ from: "2026-07-01", to: "2026-09-30", label: "Q2 FY2026-27" });
  });
});

describe("returns with reasons", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([offlineDb.cache_ledgers.clear(), offlineDb.cache_vouchers.clear()]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "ram", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "kumar", company_id: CO, name: "Kumar Supplies", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string, party: string, total: number, narration: string | null, number = id) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: number,
      voucher_date: date,
      party_ledger_id: party,
      total_paise: total,
      narration,
      is_deleted: false,
      updated_at: now,
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("cn1", "credit_note", "2026-10-05", "ram", 150_000, "Damaged rice bags", "CN-1"),
      v("cn2", "credit_note", "2026-11-10", "ram", 50_000, "   ", "CN-2"),
      v("cn-old", "credit_note", "2026-09-30", "ram", 999_000, "Last quarter", "CN-0"), // outside the quarter
      v("dn1", "debit_note", "2026-12-01", "kumar", 80_000, "Wrong grade", "DN-1"),
      v("dn2", "debit_note", "2026-12-20", "kumar", 20_000, null, "DN-2"),
      v("sale1", "sales", "2026-11-01", "ram", 700_000, "A sale, not a return", "S-1"),
    ] as never[]);
  });

  it("totals sales returns (credit notes) with reasons, largest first, and leaves out other quarters", async () => {
    const res = await runReturnsSummary({ companyId: CO, ...Q3 });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.salesReturns.totalPaise).toBe(200_000);
    expect(res.salesReturns.count).toBe(2);
    expect(res.salesReturns.rows).toEqual([
      expect.objectContaining({ voucherNumber: "CN-1", party: "Ram Traders", amountPaise: 150_000, reason: "Damaged rice bags" }),
      expect.objectContaining({ voucherNumber: "CN-2", amountPaise: 50_000, reason: null }),
    ]);
  });

  it("totals purchase returns (debit notes); a blank narration is reported as no reason", async () => {
    const res = await runReturnsSummary({ companyId: CO, ...Q3 });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.purchaseReturns.totalPaise).toBe(100_000);
    expect(res.purchaseReturns.count).toBe(2);
    expect(res.purchaseReturns.rows.map((r) => r.reason)).toEqual(["Wrong grade", null]);
  });

  it("labels an explicit period by its dates", async () => {
    const res = await runReturnsSummary({ companyId: CO, ...Q3 });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.periodLabel).toBe("2026-10-01 to 2026-12-31");
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runReturnsSummary({ companyId: CO, from: "31/02/2026" });
    expect(res.status).toBe("invalid_date");
  });
});
