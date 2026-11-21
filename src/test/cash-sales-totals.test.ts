import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runCashBankTotal, runSalesTotal } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// Same books as ai-answers-audit.test.ts:
//  5 Apr  sale to Ram Traders 25,000        (Sales Cr 25,000)
//  10 Apr receipt from Ram Traders 10,000    (HDFC Dr 10,000)
//  12 Apr cash payment for office 2,000      (Cash Cr 2,000)
// Cash closes at 2,000 Cr, HDFC at 10,000 Dr, so cash and bank total 8,000 Dr.
const CO = "co-totals";

describe("routing: cash-and-bank total and sales total", () => {
  it("routes the questionnaire wording for cash and bank to the total", () => {
    const r = routeQuery("What is our current cash and bank balance across all accounts as of today?");
    expect(r.intent).toBe("cash_bank_total");
  });

  it("routes 'total cash and bank' to the total", () => {
    expect(routeQuery("total cash and bank").intent).toBe("cash_bank_total");
  });

  it("keeps the single cash balance and single bank balance routes", () => {
    expect(routeQuery("cash balance").intent).toBe("cash_balance");
    expect(routeQuery("kotak balance").intent).toBe("bank_balance");
  });

  it("routes total sales for a financial year to sales_total with that year's dates", () => {
    const r = routeQuery("what is total sales of 2025-26");
    expect(r.intent).toBe("sales_total");
    expect(r.from).toBe("2025-04-01");
    expect(r.to).toBe("2026-03-31");
  });

  it("routes plain total sales with no period to sales_total", () => {
    expect(routeQuery("what is our total sales").intent).toBe("sales_total");
  });

  it("leaves month-named sales questions to the month report", () => {
    expect(routeQuery("sales in march 2026").intent).toBe("date_range_report");
  });

  it("does not route a party's sales or a sales register to the company total", () => {
    expect(routeQuery("sales of Ram Traders").intent).not.toBe("sales_total");
    expect(routeQuery("show sales register").intent).not.toBe("sales_total");
    expect(routeQuery("total sales by month").intent).not.toBe("sales_total");
    expect(routeQuery("total sales return this quarter").intent).not.toBe("sales_total");
  });
});

describe("figures from seeded books", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "l-cash", company_id: CO, name: "Cash-in-Hand", group_name: "Cash-in-Hand", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-ram", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-sales", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-office", company_id: CO, name: "Office Expenses", group_name: "Indirect Expenses", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    await offlineDb.cache_vouchers.bulkPut([
      { id: "v1", company_id: CO, voucher_type: "sales", voucher_number: "1", voucher_date: "2026-04-05", total_paise: 2_500_000, is_deleted: false, updated_at: now },
      { id: "v2", company_id: CO, voucher_type: "receipt", voucher_number: "2", voucher_date: "2026-04-10", total_paise: 1_000_000, is_deleted: false, updated_at: now },
      { id: "v3", company_id: CO, voucher_type: "payment", voucher_number: "3", voucher_date: "2026-04-12", total_paise: 200_000, is_deleted: false, updated_at: now },
      { id: "v4", company_id: CO, voucher_type: "sales", voucher_number: "4", voucher_date: "2025-12-01", total_paise: 900_000, is_deleted: false, updated_at: now },
      { id: "v5", company_id: CO, voucher_type: "sales", voucher_number: "5", voucher_date: "2026-04-20", total_paise: 400_000, is_deleted: true, updated_at: now },
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "v1", ledger_id: "l-ram", company_id: CO, debit_paise: 2_500_000, credit_paise: 0 },
      { id: "e2", voucher_id: "v1", ledger_id: "l-sales", company_id: CO, debit_paise: 0, credit_paise: 2_500_000 },
      { id: "e3", voucher_id: "v2", ledger_id: "l-hdfc", company_id: CO, debit_paise: 1_000_000, credit_paise: 0 },
      { id: "e4", voucher_id: "v2", ledger_id: "l-ram", company_id: CO, debit_paise: 0, credit_paise: 1_000_000 },
      { id: "e5", voucher_id: "v3", ledger_id: "l-office", company_id: CO, debit_paise: 200_000, credit_paise: 0 },
      { id: "e6", voucher_id: "v3", ledger_id: "l-cash", company_id: CO, debit_paise: 0, credit_paise: 200_000 },
    ] as never[]);
  });

  it("cash and bank total: cash 2,000 Cr plus HDFC 10,000 Dr is 8,000 Dr", async () => {
    const res = await runCashBankTotal({ companyId: CO, asOn: "2026-04-30" });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.totalPaise).toBe(800_000);
    expect(res.rows.map((r) => [r.kind, r.closingPaise])).toEqual([
      ["cash", -200_000],
      ["bank", 1_000_000],
    ]);
  });

  it("cash and bank total as on a date before the payment uses the opening position", async () => {
    const res = await runCashBankTotal({ companyId: CO, asOn: "2026-04-09" });
    expect(res.status === "resolved" && res.totalPaise).toBe(0);
  });

  it("sales total for a period sums live sales vouchers only", async () => {
    const res = await runSalesTotal({ companyId: CO, from: "2026-04-01", to: "2027-03-31" });
    expect(res).toMatchObject({ status: "resolved", count: 1, totalPaise: 2_500_000 });
  });

  it("sales total for the previous year is a different figure", async () => {
    const res = await runSalesTotal({ companyId: CO, from: "2025-04-01", to: "2026-03-31" });
    expect(res).toMatchObject({ status: "resolved", count: 1, totalPaise: 900_000 });
  });

  it("sales total with no period defaults to the current financial year", async () => {
    const res = await runSalesTotal({ companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.from).toBe("2026-04-01");
    expect(res.to).toBe("2027-03-31");
    expect(res.totalPaise).toBe(2_500_000);
  });

  it("rejects an impossible date rather than guessing", async () => {
    const res = await runSalesTotal({ companyId: CO, from: "2026-02-30", to: "2027-03-31" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tools return the same figures as the engine", async () => {
    const cash = await executeTool("get_cash_bank_total", { asOn: "2026-04-30" });
    expect(cash.success).toBe(true);
    expect((cash.data as any).data.total_paise).toBe(800_000);

    const sales = await executeTool("get_sales_total", { from: "2026-04-01", to: "2027-03-31" });
    expect(sales.success).toBe(true);
    expect((sales.data as any).data).toMatchObject({ count: 1, total_paise: 2_500_000 });
  });
});
