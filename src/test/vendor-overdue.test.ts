import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runVendorOverdue } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// ABC Traders: bill 40,000 on 5 Jan, paid 10,000 on 1 Feb → 30,000 payable, over 30 days at 30 Apr.
// Mehta Supplies: bill 5,000 on 20 Apr → under 30 days, not overdue.
// Shah Corp: payment 2,000 on 10 Apr with no bill → unadjusted advance of 2,000.
const CO = "co-vendor";

describe("routing: vendors overdue or with unadjusted advances", () => {
  it("routes the questionnaire wording to vendor_overdue", () => {
    expect(routeQuery("Which vendors have overdue balances or unadjusted debit notes/advances?").intent).toBe(
      "vendor_overdue",
    );
  });

  it("keeps the payables total and due-date question on its own route", () => {
    expect(routeQuery("What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?").intent).not.toBe(
      "vendor_overdue",
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
      { id: "l-abc", company_id: CO, name: "ABC Traders", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-mehta", company_id: CO, name: "Mehta Supplies", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-shah", company_id: CO, name: "Shah Corp", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-purch", company_id: CO, name: "Purchase Account", group_name: "Purchase Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string, total: number) => ({ id, company_id: CO, voucher_type: type, voucher_number: id, voucher_date: date, total_paise: total, is_deleted: false, updated_at: now });
    await offlineDb.cache_vouchers.bulkPut([
      v("b1", "purchase", "2026-01-05", 4_000_000),
      v("p1", "payment", "2026-02-01", 1_000_000),
      v("b2", "purchase", "2026-04-20", 500_000),
      v("p2", "payment", "2026-04-10", 200_000),
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "b1", ledger_id: "l-purch", company_id: CO, debit_paise: 4_000_000, credit_paise: 0 },
      { id: "e2", voucher_id: "b1", ledger_id: "l-abc", company_id: CO, debit_paise: 0, credit_paise: 4_000_000 },
      { id: "e3", voucher_id: "p1", ledger_id: "l-abc", company_id: CO, debit_paise: 1_000_000, credit_paise: 0 },
      { id: "e4", voucher_id: "p1", ledger_id: "l-hdfc", company_id: CO, debit_paise: 0, credit_paise: 1_000_000 },
      { id: "e5", voucher_id: "b2", ledger_id: "l-purch", company_id: CO, debit_paise: 500_000, credit_paise: 0 },
      { id: "e6", voucher_id: "b2", ledger_id: "l-mehta", company_id: CO, debit_paise: 0, credit_paise: 500_000 },
      { id: "e7", voucher_id: "p2", ledger_id: "l-shah", company_id: CO, debit_paise: 200_000, credit_paise: 0 },
      { id: "e8", voucher_id: "p2", ledger_id: "l-hdfc", company_id: CO, debit_paise: 0, credit_paise: 200_000 },
    ] as never[]);
  });

  it("flags ABC Traders for the 30,000 payable over 30 days, and Shah Corp for its advance", async () => {
    const res = await runVendorOverdue({ companyId: CO, asOn: "2026-04-30" });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.flagged).toEqual([
      expect.objectContaining({ name: "ABC Traders", overduePaise: 3_000_000, outstandingPaise: 3_000_000, advancePaise: 0 }),
      expect.objectContaining({ name: "Shah Corp", overduePaise: 0, advancePaise: 200_000 }),
    ]);
  });

  it("does not flag Mehta Supplies: its bill is under 30 days old", async () => {
    const res = await runVendorOverdue({ companyId: CO, asOn: "2026-04-30" });
    expect(res.status === "resolved" && res.flagged.some((r) => r.name === "Mehta Supplies")).toBe(false);
  });

  it("rejects an impossible date", async () => {
    const res = await runVendorOverdue({ companyId: CO, asOn: "2026-02-31" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same vendors as the engine", async () => {
    const out = await executeTool("get_vendor_overdue", { asOn: "2026-04-30" });
    expect(out.success).toBe(true);
    expect((out.data as any).data.rows[0]).toMatchObject({ name: "ABC Traders", overdue_paise: 3_000_000 });
    expect((out.data as any).data.rows[1]).toMatchObject({ name: "Shah Corp", advance_paise: 200_000 });
  });
});
