import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runMonthlyTrend } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 4.3: month-by-month revenue and expenses. Paise throughout.
const CO = "co-trend";
const FROM = "2026-04-01";
const TO = "2027-03-31";

describe("routing: monthly trend", () => {
  it("routes the questionnaire wording to monthly_trend", () => {
    expect(routeQuery("What is our month-on-month revenue and expense trend for the current financial year?").intent).toBe("monthly_trend");
  });

  it("keeps the plain sales total question on sales_total", () => {
    expect(routeQuery("What is our total sales this financial year?").intent).toBe("sales_total");
  });
});

describe("monthly revenue and expense trend", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
    ]);
    const now = new Date().toISOString();
    const L = (id: string, name: string, group: string, isDebit = true) => ({
      id,
      company_id: CO,
      name,
      group_name: group,
      opening_balance_paise: 0,
      opening_balance_is_debit: isDebit,
      updated_at: now,
    });
    await offlineDb.cache_ledgers.bulkPut([
      L("ram", "Ram Traders", "Sundry Debtors"),
      L("sales", "Sales Account", "Sales Accounts", false),
      L("purch", "Purchase Account", "Direct Expenses"),
      L("rent", "Rent", "Indirect Expenses"),
      L("bank", "HDFC Bank", "Bank Accounts"),
    ] as never[]);
    const v = (id: string, type: string, date: string) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: id,
      voucher_date: date,
      total_paise: 0,
      is_deleted: false,
      updated_at: now,
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("s1", "sales", "2026-04-10"),
      v("p1", "purchase", "2026-04-20"),
      v("x1", "payment", "2026-04-30"),
      v("s2", "sales", "2026-05-05"),
      v("cn1", "credit_note", "2026-05-15"),
    ] as never[]);
    const e = (id: string, voucher: string, ledger: string, debit: number, credit: number, date?: string) => ({
      id,
      company_id: CO,
      voucher_id: voucher,
      ledger_id: ledger,
      debit_paise: debit,
      credit_paise: credit,
      is_deleted: false,
    });
    await offlineDb.cache_voucher_entries.bulkPut([
      e("e1", "s1", "ram", 1_000_000, 0),
      e("e2", "s1", "sales", 0, 1_000_000),
      e("e3", "p1", "purch", 400_000, 0),
      e("e4", "p1", "bank", 0, 400_000),
      e("e5", "x1", "rent", 50_000, 0),
      e("e6", "x1", "bank", 0, 50_000),
      e("e7", "s2", "ram", 500_000, 0),
      e("e8", "s2", "sales", 0, 500_000),
      e("e9", "cn1", "sales", 100_000, 0), // credit note reduces revenue
      e("e10", "cn1", "ram", 0, 100_000),
    ] as never[]);
  });

  it("shows revenue, expenses and net for each month, with change on the month before", async () => {
    const res = await runMonthlyTrend({ companyId: CO, from: FROM, to: TO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.rows).toEqual([
      expect.objectContaining({ month: "2026-04", revenuePaise: 1_000_000, expensePaise: 450_000, netPaise: 550_000, revenueChangePct: null, expenseChangePct: null }),
      expect.objectContaining({ month: "2026-05", revenuePaise: 400_000, expensePaise: 0, netPaise: 400_000, revenueChangePct: -60, expenseChangePct: -100 }),
    ]);
    expect(res.revenueTotalPaise).toBe(1_400_000);
    expect(res.expenseTotalPaise).toBe(450_000);
  });

  it("does not show months after the latest posting", async () => {
    const res = await runMonthlyTrend({ companyId: CO, from: FROM, to: TO });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.rows.map((r) => r.month)).toEqual(["2026-04", "2026-05"]);
  });

  it("returns no rows for a period with no postings", async () => {
    const res = await runMonthlyTrend({ companyId: CO, from: "2025-04-01", to: "2026-03-31" });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.rows).toEqual([]);
    expect(res.revenueTotalPaise).toBe(0);
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runMonthlyTrend({ companyId: CO, from: "31/02/2026" });
    expect(res.status).toBe("invalid_date");
  });
});
