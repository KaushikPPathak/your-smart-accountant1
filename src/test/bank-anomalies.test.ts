import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runBankAnomalies } from "@/lib/ai/accounting-query-engine";
import { executeTool } from "@/lib/ai/tools";
import { offlineDb } from "@/lib/offline/db";

// HDFC: payments out of 10,000 in Jan, Feb and Mar, then 50,000 in Apr → spike (5×).
// Cash: 1,000 out every month → no spike (below the ₹10,000 floor).
const CO = "co-anomaly";
const CASH_OUT = 100_000; // ₹1,000

function payment(id: string, date: string, ledger: string, paise: number) {
  return { voucher: { id, company_id: CO, voucher_type: "payment", voucher_number: id, voucher_date: date, total_paise: paise, is_deleted: false, updated_at: "" },
    entries: [
      { id: `${id}-d`, voucher_id: id, ledger_id: "l-office", company_id: CO, debit_paise: paise, credit_paise: 0 },
      { id: `${id}-c`, voucher_id: id, ledger_id: ledger, company_id: CO, debit_paise: 0, credit_paise: paise },
    ] };
}

describe("routing: bank and cash outflow spikes", () => {
  it("routes the questionnaire wording to bank_anomalies", () => {
    expect(routeQuery("Which bank or cash ledger has seen unusual spikes or out-of-pattern withdrawals recently?").intent).toBe(
      "bank_anomalies",
    );
  });

  it("does not take the cash and bank total or single balances", () => {
    expect(routeQuery("cash balance").intent).toBe("cash_balance");
    expect(routeQuery("total cash and bank").intent).toBe("cash_bank_total");
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
      { id: "l-cash", company_id: CO, name: "Cash-in-Hand", group_name: "Cash-in-Hand", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "l-office", company_id: CO, name: "Office Expenses", group_name: "Indirect Expenses", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);

    const specs = [
      payment("h1", "2026-01-10", "l-hdfc", 1_000_000),
      payment("h2", "2026-02-10", "l-hdfc", 1_000_000),
      payment("h3", "2026-03-10", "l-hdfc", 1_000_000),
      payment("h4", "2026-04-10", "l-hdfc", 5_000_000),
      payment("c1", "2026-01-05", "l-cash", CASH_OUT),
      payment("c2", "2026-02-05", "l-cash", CASH_OUT),
      payment("c3", "2026-03-05", "l-cash", CASH_OUT),
      payment("c4", "2026-04-05", "l-cash", CASH_OUT),
    ];
    await offlineDb.cache_vouchers.bulkPut(specs.map((s) => s.voucher) as never[]);
    await offlineDb.cache_voucher_entries.bulkPut(specs.flatMap((s) => s.entries) as never[]);
  });

  it("flags the HDFC April outflow against the Jan–Mar average", async () => {
    const res = await runBankAnomalies({ companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.checkedLedgers).toBe(2);
    expect(res.flagged).toHaveLength(1);
    expect(res.flagged[0]).toMatchObject({
      ledgerName: "HDFC Bank",
      kind: "bank",
      month: "2026-04",
      outflowPaise: 5_000_000,
      baselinePaise: 1_000_000,
      baselineMonths: 3,
      ratio: 5,
    });
  });

  it("does not flag cash, because its outflow is under the ₹10,000 floor", async () => {
    const res = await runBankAnomalies({ companyId: CO });
    expect(res.status === "resolved" && res.flagged.some((r) => r.ledgerName === "Cash-in-Hand")).toBe(false);
  });

  it("as on a date before the spike there is nothing to flag", async () => {
    const res = await runBankAnomalies({ companyId: CO, asOn: "2026-03-31" });
    expect(res.status === "resolved" && res.flagged).toEqual([]);
  });

  it("rejects an impossible date", async () => {
    const res = await runBankAnomalies({ companyId: CO, asOn: "2026-02-31" });
    expect(res.status).toBe("invalid_date");
  });

  it("the tool returns the same spike as the engine", async () => {
    const out = await executeTool("get_bank_anomalies", {});
    expect(out.success).toBe(true);
    expect((out.data as any).data.rows).toEqual([
      expect.objectContaining({ name: "HDFC Bank", month: "2026-04", outflow_paise: 5_000_000, ratio: 5 }),
    ]);
  });
});
