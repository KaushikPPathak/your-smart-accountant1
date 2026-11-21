import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runVendorSpendCycle } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// ABC Traders: bill 40,000 on 5 Jan; payment 10,000 on 1 Feb (matched FIFO to the 5 Jan bill: 27 days);
//              bill 5,000 on 20 Apr. Latest posting is 20 Apr, so the default window is Nov 2025 – Apr 2026.
// Spend in window: 45,000 across 2 bills. Average cycle: 27.0 days on 10,000 settled.
// ABC Stores exists with no postings, so "ABC" is ambiguous. "Zed Corp" does not exist.
const CO = "co-spend";

describe("routing: vendor spend and payment cycle", () => {
  it("routes the questionnaire wording and takes the vendor name", () => {
    const r = routeQuery("What is the total spend and average payment cycle for ABC Traders over the last 6 months?");
    expect(r.intent).toBe("vendor_spend_cycle");
    expect(r.entity?.partyName).toBe("ABC Traders");
  });

  it("does not take the payables total question", () => {
    expect(routeQuery("What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?").intent).not.toBe(
      "vendor_spend_cycle",
    );
  });

  it("a payment-cycle question with no vendor name carries no name", () => {
    const r = routeQuery("What is our average payment cycle over the last 6 months?");
    expect(r.intent).toBe("vendor_spend_cycle");
    expect(r.entity?.partyName).toBeUndefined();
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
      { id: "l-abcs", company_id: CO, name: "ABC Stores", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-purch", company_id: CO, name: "Purchase Account", group_name: "Purchase Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string, total: number) => ({ id, company_id: CO, voucher_type: type, voucher_number: id, voucher_date: date, total_paise: total, is_deleted: false, updated_at: now });
    await offlineDb.cache_vouchers.bulkPut([
      v("b1", "purchase", "2026-01-05", 4_000_000),
      v("p1", "payment", "2026-02-01", 1_000_000),
      v("b2", "purchase", "2026-04-20", 500_000),
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "b1", ledger_id: "l-purch", company_id: CO, debit_paise: 4_000_000, credit_paise: 0 },
      { id: "e2", voucher_id: "b1", ledger_id: "l-abc", company_id: CO, debit_paise: 0, credit_paise: 4_000_000 },
      { id: "e3", voucher_id: "p1", ledger_id: "l-abc", company_id: CO, debit_paise: 1_000_000, credit_paise: 0 },
      { id: "e4", voucher_id: "p1", ledger_id: "l-hdfc", company_id: CO, debit_paise: 0, credit_paise: 1_000_000 },
      { id: "e5", voucher_id: "b2", ledger_id: "l-purch", company_id: CO, debit_paise: 500_000, credit_paise: 0 },
      { id: "e6", voucher_id: "b2", ledger_id: "l-abc", company_id: CO, debit_paise: 0, credit_paise: 500_000 },
    ] as never[]);
  });

  it("spend is 45,000 over two bills, and the cycle is 27 days (FIFO)", async () => {
    const res = await runVendorSpendCycle({ companyId: CO, vendorName: "ABC Traders" });
    expect(res).toMatchObject({
      status: "resolved",
      vendor: "ABC Traders",
      from: "2025-11-01",
      to: "2026-04-30",
      spendPaise: 4_500_000,
      billCount: 2,
      settledPaise: 1_000_000,
      averageCycleDays: 27,
      unmatchedPaymentsPaise: 0,
      method: "fifo",
    });
  });

  it("a window with no payment reports no cycle, and still reports spend", async () => {
    const res = await runVendorSpendCycle({ companyId: CO, vendorName: "ABC Traders", from: "2026-03-01", to: "2026-04-30" });
    expect(res).toMatchObject({ status: "resolved", spendPaise: 500_000, billCount: 1, settledPaise: 0, averageCycleDays: null });
  });

  it("a name that matches two ledgers is ambiguous, not guessed", async () => {
    const res = await runVendorSpendCycle({ companyId: CO, vendorName: "ABC" });
    expect(res).toEqual({ status: "ambiguous", query: "ABC", candidates: expect.arrayContaining(["ABC Traders", "ABC Stores"]) });
  });

  it("an unknown vendor is not found", async () => {
    const res = await runVendorSpendCycle({ companyId: CO, vendorName: "Zed Corp" });
    expect(res).toEqual({ status: "not_found", query: "Zed Corp" });
  });

  it("rejects an impossible date", async () => {
    const res = await runVendorSpendCycle({ companyId: CO, vendorName: "ABC Traders", from: "2026-02-30" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same figures as the engine", async () => {
    const out = await executeTool("get_vendor_spend_cycle", { vendor: "ABC Traders" });
    expect(out.success).toBe(true);
    expect((out.data as any).data).toMatchObject({ status: "resolved", spend_paise: 4_500_000, average_cycle_days: 27 });
  });
});
