import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runAccountingQuery, runTrialBalance } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Books with known answers:
//  5 Apr  sale to Ram Traders 25,000        (Ram Dr 25,000 / Sales Cr 25,000)
//  10 Apr receipt from Ram Traders 10,000    (HDFC Dr 10,000 / Ram Cr 10,000)
//  12 Apr cash payment for office 2,000      (Office Dr 2,000 / Cash Cr 2,000)
const CO = "co-audit";
const RAM = 2_500_000; // paise
const HDFC = 1_000_000;
const CASH = 200_000;

describe("AI answers: numbers from seeded books", () => {
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
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "v1", ledger_id: "l-ram", company_id: CO, debit_paise: RAM, credit_paise: 0 },
      { id: "e2", voucher_id: "v1", ledger_id: "l-sales", company_id: CO, debit_paise: 0, credit_paise: RAM },
      { id: "e3", voucher_id: "v2", ledger_id: "l-hdfc", company_id: CO, debit_paise: HDFC, credit_paise: 0 },
      { id: "e4", voucher_id: "v2", ledger_id: "l-ram", company_id: CO, debit_paise: 0, credit_paise: HDFC },
      { id: "e5", voucher_id: "v3", ledger_id: "l-office", company_id: CO, debit_paise: CASH, credit_paise: 0 },
      { id: "e6", voucher_id: "v3", ledger_id: "l-cash", company_id: CO, debit_paise: 0, credit_paise: CASH },
    ] as never[]);
  });

  it("party balance: Ram owes 15,000 Dr after the receipt", async () => {
    const res = await runAccountingQuery({ kind: "party_balance", name: "Ram Traders", asOn: "2026-04-30", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", closingPaise: 1_500_000, direction: "Dr" });
  });

  it("party balance as on a date before the receipt shows the full sale", async () => {
    const res = await runAccountingQuery({ kind: "party_balance", name: "Ram Traders", asOn: "2026-04-07", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", closingPaise: RAM, direction: "Dr" });
  });

  it("bank balance: HDFC 10,000 Dr", async () => {
    const res = await runAccountingQuery({ kind: "bank_balance", name: "HDFC", asOn: "2026-04-30", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", closingPaise: HDFC, direction: "Dr" });
  });

  it("bare bank balance uses the only bank ledger", async () => {
    const res = await runAccountingQuery({ kind: "bank_balance", asOn: "2026-04-30", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", closingPaise: HDFC, direction: "Dr" });
  });

  it("cash balance: 2,000 Cr after the payment", async () => {
    const res = await runAccountingQuery({ kind: "cash_balance", asOn: "2026-04-30", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", closingPaise: -CASH, direction: "Cr" });
  });

  it("trial balance agrees and its totals match the books", async () => {
    const tb = await runTrialBalance({ asOn: "2026-04-30", companyId: CO });
    expect(tb).toMatchObject({ status: "resolved", balanced: true });
    if (tb.status !== "resolved") return;
    // Each ledger shows its net closing balance: Ram 15,000 Dr, HDFC 10,000 Dr, office 2,000 Dr
    // against sales 25,000 Cr and cash 2,000 Cr. Both sides total 27,000.
    expect(tb.totalDebitPaise).toBe(tb.totalCreditPaise);
    expect(tb.totalDebitPaise).toBe(1_500_000 + HDFC + CASH);
  });
});

describe("AI answers: routing bugs found in the audit", () => {
  it("'bank balance' with no bank named is a bank question, not a party called 'bank'", () => {
    const r = routeQuery("bank balance");
    expect(r.intent).toBe("bank_balance");
    expect(r.entity?.partyName).toBeUndefined();
  });

  it("'balance sheet' is not a party balance", () => {
    expect(routeQuery("balance sheet").intent).not.toBe("party_balance");
  });

  it("'what is cash in hand' is a cash balance question", () => {
    expect(routeQuery("what is cash in hand").intent).toBe("cash_balance");
  });
});

describe("report questions are declined, not guessed", () => {
  const reports = [
    "Which bank or cash ledger has seen unusual spikes or out-of-pattern withdrawals recently?",
    "What is the difference between our bank statement balance and book balance for HDFC this month?",
    "Who are our top 10 customers by revenue and by overdue balance this financial year?",
    "What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?",
    "Which vendors account for 80% of our purchase spend this year?",
    "Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)?",
    "Do Trial Balance, Balance Sheet, and Profit & Loss totals reconcile cleanly with zero unexplained differences?",
  ];
  for (const q of reports) {
    it(`declines: ${q.slice(0, 60)}`, () => {
      expect(routeQuery(q).unsupportedReport).toBe(true);
    });
  }

  it("a party's outstanding balance and payment history is still a party question", () => {
    const r = routeQuery("total outstanding balance and payment history for Ram Traders");
    expect(r.intent).toBe("party_balance");
    expect(r.entity?.partyName).toBe("Ram Traders");
  });
});

describe("party receivables and payables are answered locally", () => {
  it("receivables by ageing buckets", () => {
    const r = routeQuery("What is our total accounts receivable, broken down by aging buckets?");
    expect(r.intent).toBe("party_summary");
    expect(r.entity?.summarySide).toBe("receivable");
    expect(r.requiresLLM).toBe(false);
  });

  it("'who owes us' is a receivables question", () => {
    expect(routeQuery("who owes us the most").entity?.summarySide).toBe("receivable");
  });

  it("'top 10 vendors' is a payables question", () => {
    expect(routeQuery("top 10 vendors by outstanding").entity?.summarySide).toBe("payable");
  });

  it("a named party stays a party question", () => {
    expect(routeQuery("receivable from Ram Traders").intent).not.toBe("party_summary");
  });
});

