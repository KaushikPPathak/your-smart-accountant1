import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runCustomerRanking } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// Ram Traders: sale 25,000 on 5 Jan (party), receipt 10,000 on 1 Feb → 15,000 outstanding, over 30 days at 30 Apr.
// Gupta Stores: sale 5,000 on 20 Apr → under 30 days, so not overdue.
// Revenue, 1 Jan – 30 Apr 2026: Ram 25,000 (1 voucher), Gupta 5,000 (1 voucher).
const CO = "co-ranking";
const PERIOD = { from: "2026-01-01", to: "2026-04-30" };

describe("routing: top customers by revenue and overdue", () => {
  it("routes the questionnaire wording to customer_ranking", () => {
    const r = routeQuery("Who are our top 10 customers by revenue and by overdue balance this financial year?");
    expect(r.intent).toBe("customer_ranking");
    expect(r.unsupportedReport).toBeFalsy();
  });

  it("keeps the credit-limit question on credit_watch", () => {
    expect(routeQuery("Which customers have overdue invoices past their credit limit or credit period?").intent).toBe(
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
      { id: "l-ram", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-gupta", company_id: CO, name: "Gupta Stores", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-sales", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string, total: number, party?: string) => ({
      id, company_id: CO, voucher_type: type, voucher_number: id, voucher_date: date, total_paise: total, is_deleted: false, updated_at: now,
      ...(party ? { party_ledger_id: party } : {}),
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("s1", "sales", "2026-01-05", 2_500_000, "l-ram"),
      v("r1", "receipt", "2026-02-01", 1_000_000, "l-ram"),
      v("s2", "sales", "2026-04-20", 500_000, "l-gupta"),
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

  it("ranks customers by revenue in the period, largest first", async () => {
    const res = await runCustomerRanking({ companyId: CO, ...PERIOD });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.byRevenue).toEqual([
      expect.objectContaining({ name: "Ram Traders", revenuePaise: 2_500_000, vouchers: 1 }),
      expect.objectContaining({ name: "Gupta Stores", revenuePaise: 500_000, vouchers: 1 }),
    ]);
  });

  it("ranks by overdue: only Ram Traders has a balance over 30 days old", async () => {
    const res = await runCustomerRanking({ companyId: CO, ...PERIOD });
    expect(res.status === "resolved" && res.byOverdue).toEqual([
      expect.objectContaining({ name: "Ram Traders", overduePaise: 1_500_000, outstandingPaise: 1_500_000 }),
    ]);
  });

  it("revenue outside the period is not counted", async () => {
    const res = await runCustomerRanking({ companyId: CO, from: "2026-04-01", to: "2026-04-30" });
    expect(res.status === "resolved" && res.byRevenue).toEqual([
      expect.objectContaining({ name: "Gupta Stores", revenuePaise: 500_000 }),
    ]);
  });

  it("rejects an impossible date", async () => {
    const res = await runCustomerRanking({ companyId: CO, from: "2026-02-30", to: "2026-04-30" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same rankings as the engine", async () => {
    const out = await executeTool("get_customer_ranking", PERIOD);
    expect(out.success).toBe(true);
    expect((out.data as any).data.by_revenue[0]).toMatchObject({ name: "Ram Traders", revenue_paise: 2_500_000 });
    expect((out.data as any).data.by_overdue[0]).toMatchObject({ name: "Ram Traders", overdue_paise: 1_500_000 });
  });
});
