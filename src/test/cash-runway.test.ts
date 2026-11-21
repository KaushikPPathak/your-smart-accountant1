import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runCashRunway } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// HDFC position: 60,000 at 31 Dec 2025 (receipt in Dec).
// Burn: 10,000 out in each of Jan, Feb, Mar → 30,000 at 31 Mar → (60,000 − 30,000) ÷ 3 = 10,000 a month.
// April receipt of 10,000 → current position 40,000 (latest posting, April 2026).
// Runway: 40,000 ÷ (10,000 ÷ 30) = 120 days.
const CO = "co-runway";
const RS = 1_000_000; // ₹10,000 in paise

function voucher(id: string, date: string, debitLedger: string, creditLedger: string, paise: number) {
  return {
    voucher: { id, company_id: CO, voucher_type: "journal", voucher_number: id, voucher_date: date, total_paise: paise, is_deleted: false, updated_at: "" },
    entries: [
      { id: `${id}-d`, voucher_id: id, ledger_id: debitLedger, company_id: CO, debit_paise: paise, credit_paise: 0 },
      { id: `${id}-c`, voucher_id: id, ledger_id: creditLedger, company_id: CO, debit_paise: 0, credit_paise: paise },
    ],
  };
}

describe("routing: cash runway", () => {
  it("routes the questionnaire wording to cash_runway", () => {
    expect(
      routeQuery("How many days of operating runway do we have based on current cash and average monthly burn?").intent,
    ).toBe("cash_runway");
  });

  it("does not take the plain cash balance", () => {
    expect(routeQuery("cash balance").intent).toBe("cash_balance");
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
      { id: "l-hdfc", company_id: CO, name: "HDFC Bank", group_name: "Bank Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-cap", company_id: CO, name: "Capital", group_name: "Capital Account", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "l-office", company_id: CO, name: "Office Expenses", group_name: "Indirect Expenses", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
  });

  async function seed(specs: ReturnType<typeof voucher>[]) {
    await offlineDb.cache_vouchers.bulkPut(specs.map((s) => s.voucher) as never[]);
    await offlineDb.cache_voucher_entries.bulkPut(specs.flatMap((s) => s.entries) as never[]);
  }

  it("runway is 120 days at a burn of 10,000 a month from a 40,000 position", async () => {
    await seed([
      voucher("r0", "2025-12-15", "l-hdfc", "l-cap", 6 * RS),
      voucher("p1", "2026-01-10", "l-office", "l-hdfc", RS),
      voucher("p2", "2026-02-10", "l-office", "l-hdfc", RS),
      voucher("p3", "2026-03-10", "l-office", "l-hdfc", RS),
      voucher("r4", "2026-04-02", "l-hdfc", "l-cap", RS),
    ]);
    const res = await runCashRunway({ companyId: CO });
    expect(res).toMatchObject({
      status: "resolved",
      latestDate: "2026-04-02",
      windowFrom: "2026-01",
      windowTo: "2026-03",
      startPositionPaise: 6 * RS,
      endPositionPaise: 3 * RS,
      currentPositionPaise: 4 * RS,
      monthlyBurnPaise: RS,
      runwayDays: 120,
      reason: "runway",
    });
  });

  it("says there is not enough history when the books start too late", async () => {
    await seed([
      voucher("p2", "2026-02-10", "l-office", "l-hdfc", RS),
      voucher("r4", "2026-04-02", "l-hdfc", "l-cap", RS),
    ]);
    const res = await runCashRunway({ companyId: CO });
    expect(res.status).toBe("short_history");
  });

  it("says cash is not falling when the window gained cash", async () => {
    await seed([
      voucher("r0", "2025-12-15", "l-hdfc", "l-cap", RS),
      voucher("r1", "2026-02-10", "l-hdfc", "l-cap", 5 * RS),
      voucher("r4", "2026-04-02", "l-hdfc", "l-cap", RS),
    ]);
    const res = await runCashRunway({ companyId: CO });
    expect(res).toMatchObject({ status: "resolved", reason: "not_burning", runwayDays: null });
  });

  it("says runway is exhausted when cash is overdrawn now", async () => {
    await seed([
      voucher("r0", "2025-12-15", "l-hdfc", "l-cap", 6 * RS),
      voucher("p1", "2026-01-10", "l-office", "l-hdfc", RS),
      voucher("p2", "2026-02-10", "l-office", "l-hdfc", RS),
      voucher("p3", "2026-03-10", "l-office", "l-hdfc", RS),
      voucher("p4", "2026-04-02", "l-office", "l-hdfc", 9 * RS),
    ]);
    const res = await runCashRunway({ companyId: CO });
    expect(res).toMatchObject({ status: "resolved", reason: "exhausted" });
  });

  it("rejects an impossible date", async () => {
    const res = await runCashRunway({ companyId: CO, asOn: "2026-02-31" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same runway as the engine", async () => {
    await seed([
      voucher("r0", "2025-12-15", "l-hdfc", "l-cap", 6 * RS),
      voucher("p1", "2026-01-10", "l-office", "l-hdfc", RS),
      voucher("p2", "2026-02-10", "l-office", "l-hdfc", RS),
      voucher("p3", "2026-03-10", "l-office", "l-hdfc", RS),
      voucher("r4", "2026-04-02", "l-hdfc", "l-cap", RS),
    ]);
    const out = await executeTool("get_cash_runway", {});
    expect(out.success).toBe(true);
    expect((out.data as any).data).toMatchObject({ reason: "runway", runway_days: 120, monthly_burn_paise: RS });
  });
});
