import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runCreditWatch } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// Ram Traders: sale 25,000 on 5 Jan, receipt 10,000 on 1 Feb → 15,000 outstanding from January.
//   Limit 10,000 → over the limit by 5,000. The 15,000 is over 30 days old at 30 Apr.
// Gupta: sale 5,000 on 20 Apr, no limit → 5,000 outstanding, under 30 days old → not flagged.
const CO = "co-credit";

describe("routing: customers over credit limit or overdue", () => {
  it("routes the questionnaire wording to credit_watch", () => {
    expect(routeQuery("Which customers have overdue invoices past their credit limit or credit period?").intent).toBe(
      "credit_watch",
    );
  });

  it("keeps the top-customers-by-overdue question out of the credit watch", () => {
    const r = routeQuery("Who are our top 10 customers by revenue and by overdue balance this financial year?");
    expect(r.intent).toBe("customer_ranking");
  });

  it("keeps the vendors question out of the credit watch", () => {
    expect(routeQuery("Which vendors have overdue balances or unadjusted debit notes/advances?").intent).not.toBe(
      "credit_watch",
    );
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
      { id: "l-ram", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, credit_limit_paise: 1_000_000, updated_at: now },
      { id: "l-gupta", company_id: CO, name: "Gupta Stores", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-sales", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string, total: number) => ({ id, company_id: CO, voucher_type: type, voucher_number: id, voucher_date: date, total_paise: total, is_deleted: false, updated_at: now });
    await offlineDb.cache_vouchers.bulkPut([
      v("s1", "sales", "2026-01-05", 2_500_000),
      v("r1", "receipt", "2026-02-01", 1_000_000),
      v("s2", "sales", "2026-04-20", 500_000),
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "s1", ledger_id: "l-ram", company_id: CO, debit_paise: 2_500_000, credit_paise: 0 },
      { id: "e2", voucher_id: "s1", ledger_id: "l-sales", company_id: CO, debit_paise: 0, credit_paise: 2_500_000 },
      { id: "e3", voucher_id: "r1", ledger_id: "l-hdfc", company_id: CO, debit_paise: 1_000_000, credit_paise: 0 },
      { id: "e4", voucher_id: "r1", ledger_id: "l-ram", company_id: CO, debit_paise: 0, credit_paise: 1_000_000 },
      { id: "e5", voucher_id: "s2", ledger_id: "l-gupta", company_id: CO, debit_paise: 500_000, credit_paise: 0 },
      { id: "e6", voucher_id: "s2", ledger_id: "l-sales", company_id: CO, debit_paise: 0, credit_paise: 500_000 },
    ] as never[]);
  });

  it("flags Ram Traders for both the limit and the 30-day overdue balance", async () => {
    const res = await runCreditWatch({ companyId: CO, asOn: "2026-04-30" });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.checked).toBe(2);
    expect(res.flagged).toEqual([
      expect.objectContaining({
        name: "Ram Traders",
        outstandingPaise: 1_500_000,
        creditLimitPaise: 1_000_000,
        overLimitPaise: 500_000,
        overdue30Paise: 1_500_000,
      }),
    ]);
  });

  it("does not flag Gupta: no limit, and the balance is under 30 days old", async () => {
    const res = await runCreditWatch({ companyId: CO, asOn: "2026-04-30" });
    expect(res.status === "resolved" && res.flagged.some((r) => r.name === "Gupta Stores")).toBe(false);
  });

  it("before the sale is 30 days old, only the credit limit flags", async () => {
    const res = await runCreditWatch({ companyId: CO, asOn: "2026-01-20" });
    expect(res.status === "resolved" && res.flagged).toEqual([
      expect.objectContaining({ name: "Ram Traders", outstandingPaise: 2_500_000, overLimitPaise: 1_500_000, overdue30Paise: 0 }),
    ]);
  });

  it("rejects an impossible date", async () => {
    const res = await runCreditWatch({ companyId: CO, asOn: "2026-02-31" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same flagged customer as the engine", async () => {
    const out = await executeTool("get_credit_watch", { asOn: "2026-04-30" });
    expect(out.success).toBe(true);
    expect((out.data as any).data.rows).toEqual([
      expect.objectContaining({ name: "Ram Traders", over_limit_paise: 500_000, overdue_30_paise: 1_500_000 }),
    ]);
  });
});
