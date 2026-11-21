import { beforeEach, describe, expect, it } from "vitest";
import { runPartySummary } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { localFirstAnswer } from "@/lib/ai/local-first";
import { offlineDb } from "@/lib/offline/db";

// Books:
//  Ram Traders (debtor):   sale 25,000 on 5 Apr; receipt 10,000 on 10 Apr
//  Shyam Stores (debtor):  sale 5,000 on 1 Jan
//  ABC Supplies (creditor): purchase 8,000 on 1 Feb
// As on 30 Apr: Ram owes 15,000 (25 days, 0-30); Shyam owes 5,000 (119 days, 90+);
// we owe ABC 8,000 (88 days, 61-90).
const CO = "co-party-summary";

describe("receivables and payables by party", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "ram", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "shyam", company_id: CO, name: "Shyam Stores", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "abc", company_id: CO, name: "ABC Supplies", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "sales", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "purch", company_id: CO, name: "Purchase Account", group_name: "Purchase Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "bank", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    await offlineDb.cache_vouchers.bulkPut([
      { id: "s1", company_id: CO, voucher_type: "sales", voucher_number: "1", voucher_date: "2026-04-05", is_deleted: false, updated_at: now },
      { id: "r1", company_id: CO, voucher_type: "receipt", voucher_number: "2", voucher_date: "2026-04-10", is_deleted: false, updated_at: now },
      { id: "s2", company_id: CO, voucher_type: "sales", voucher_number: "3", voucher_date: "2026-01-01", is_deleted: false, updated_at: now },
      { id: "p1", company_id: CO, voucher_type: "purchase", voucher_number: "4", voucher_date: "2026-02-01", is_deleted: false, updated_at: now },
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "s1", ledger_id: "ram", company_id: CO, debit_paise: 2_500_000, credit_paise: 0 },
      { id: "e2", voucher_id: "s1", ledger_id: "sales", company_id: CO, debit_paise: 0, credit_paise: 2_500_000 },
      { id: "e3", voucher_id: "r1", ledger_id: "bank", company_id: CO, debit_paise: 1_000_000, credit_paise: 0 },
      { id: "e4", voucher_id: "r1", ledger_id: "ram", company_id: CO, debit_paise: 0, credit_paise: 1_000_000 },
      { id: "e5", voucher_id: "s2", ledger_id: "shyam", company_id: CO, debit_paise: 500_000, credit_paise: 0 },
      { id: "e6", voucher_id: "s2", ledger_id: "sales", company_id: CO, debit_paise: 0, credit_paise: 500_000 },
      { id: "e7", voucher_id: "p1", ledger_id: "abc", company_id: CO, debit_paise: 0, credit_paise: 800_000 },
      { id: "e8", voucher_id: "p1", ledger_id: "purch", company_id: CO, debit_paise: 800_000, credit_paise: 0 },
    ] as never[]);
  });

  it("receivables: largest first, with ageing buckets and totals", async () => {
    const r = await runPartySummary({ side: "receivable", asOn: "2026-04-30", companyId: CO });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.rows.map((x) => [x.name, x.outstandingPaise])).toEqual([
      ["Ram Traders", 1_500_000],
      ["Shyam Stores", 500_000],
    ]);
    expect(r.rows[0].buckets.d0_30).toBe(1_500_000);
    expect(r.rows[1].buckets.d90p).toBe(500_000);
    expect(r.totalOutstandingPaise).toBe(2_000_000);
    expect(r.totalBuckets).toEqual({ opening: 0, d0_30: 1_500_000, d31_60: 0, d61_90: 0, d90p: 500_000 });
  });

  it("payables: the vendor we owe, aged from the purchase date", async () => {
    const r = await runPartySummary({ side: "payable", asOn: "2026-04-30", companyId: CO });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: "ABC Supplies", outstandingPaise: 800_000 });
    expect(r.rows[0].buckets.d61_90).toBe(800_000);
  });

  it("an earlier as-on date shows the position at that time", async () => {
    const r = await runPartySummary({ side: "receivable", asOn: "2026-04-07", companyId: CO });
    if (r.status !== "resolved") throw new Error("expected resolved");
    expect(r.rows.find((x) => x.name === "Ram Traders")?.outstandingPaise).toBe(2_500_000);
  });

  it("refuses a malformed as-on date", async () => {
    await expect(runPartySummary({ side: "receivable", asOn: "last month", companyId: CO })).resolves.toMatchObject({
      status: "invalid_date",
    });
  });
});

describe("the same figures through the tool and the answer text", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "ram2", company_id: CO, name: "Ram Traders", group_name: "Sundry Debtors", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "sales2", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
    ] as never[]);
    await offlineDb.cache_vouchers.put({ id: "s9", company_id: CO, voucher_type: "sales", voucher_number: "9", voucher_date: "2026-04-05", is_deleted: false, updated_at: now } as never);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "f1", voucher_id: "s9", ledger_id: "ram2", company_id: CO, debit_paise: 2_500_000, credit_paise: 0 },
      { id: "f2", voucher_id: "s9", ledger_id: "sales2", company_id: CO, debit_paise: 0, credit_paise: 2_500_000 },
    ] as never[]);
  });

  it("the tool returns the party rows and totals", async () => {
    const res = await executeTool("get_party_summary", { side: "receivable", asOn: "2026-04-30" });
    expect(res.success).toBe(true);
    const rows = (res.data as any).data.rows;
    expect(rows[0]).toMatchObject({ name: "Ram Traders", outstanding_paise: 2_500_000 });
    expect((res.data as any).facts.total_outstanding_paise).toBe(2_500_000);
  });

  it("the answer text states the total, the parties and the method", () => {
    const text = localFirstAnswer({
      kind: "party_summary",
      partySummary: {
        side: "receivable",
        asOnDate: "2026-04-30",
        rows: [{ name: "Ram Traders", outstandingPaise: 2_500_000, advancePaise: 0, buckets: { d0_30: 2_500_000 } }],
        totalOutstandingPaise: 2_500_000,
        totalBuckets: { opening: 0, d0_30: 2_500_000, d31_60: 0, d61_90: 0, d90p: 0 },
      },
    });
    expect(text).toContain("Receivables as on 2026-04-30: ₹25,000.00 from 1 party");
    expect(text).toContain("1. Ram Traders — ₹25,000.00");
    expect(text).toContain("oldest bill first");
  });
});

