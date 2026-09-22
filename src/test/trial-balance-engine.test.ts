import { describe, expect, it } from "vitest";
import {
  computeTrialBalance,
  fyEndFor,
  type EngineLedger,
  type TrialBalanceEntry,
} from "@/lib/ai/accounting-query-engine";

const ledgers: EngineLedger[] = [
  {
    id: "cash",
    name: "Cash-in-Hand",
    group_name: "Cash-in-Hand",
    opening_balance_paise: 100000,
    opening_balance_is_debit: true,
  },
  {
    id: "sales",
    name: "Sales Account",
    group_name: "Sales Accounts",
    opening_balance_paise: 0,
    opening_balance_is_debit: true,
  },
  {
    id: "creditor",
    name: "Kiran Traders",
    group_name: "Sundry Creditors",
    opening_balance_paise: 50000,
    opening_balance_is_debit: false,
  },
  {
    id: "idle",
    name: "Office Equipment",
    group_name: "Fixed Assets",
    opening_balance_paise: 0,
    opening_balance_is_debit: true,
  },
];

const entries: TrialBalanceEntry[] = [
  { ledgerId: "cash", debitPaise: 200000, creditPaise: 0, date: "2025-06-10" },
  { ledgerId: "sales", debitPaise: 0, creditPaise: 200000, date: "2025-06-10" },
  { ledgerId: "cash", debitPaise: 0, creditPaise: 50000, date: "2026-02-01" },
  { ledgerId: "creditor", debitPaise: 50000, creditPaise: 0, date: "2026-02-01" },
];

const row = (r: ReturnType<typeof computeTrialBalance>, id: string) =>
  r.rows.find((x) => x.ledgerId === id)!;

describe("trial balance engine", () => {
  it("carries opening balances with the correct sign", () => {
    const r = computeTrialBalance(ledgers, [], "2026-03-31");
    expect(row(r, "cash").openingPaise).toBe(100000);
    expect(row(r, "creditor").openingPaise).toBe(-50000);
  });

  it("aggregates debit entries per ledger", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(row(r, "cash").entryDebitPaise).toBe(200000);
    expect(row(r, "creditor").entryDebitPaise).toBe(50000);
  });

  it("aggregates credit entries per ledger", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(row(r, "cash").entryCreditPaise).toBe(50000);
    expect(row(r, "sales").entryCreditPaise).toBe(200000);
  });

  it("computes closing as opening + debit − credit", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(row(r, "cash").closingPaise).toBe(250000);
    expect(row(r, "sales").closingPaise).toBe(-200000);
    expect(row(r, "creditor").closingPaise).toBe(0);
  });

  it("classifies Dr, Cr and Nil into the right columns", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(row(r, "cash").direction).toBe("Dr");
    expect(row(r, "cash").debitPaise).toBe(250000);
    expect(row(r, "cash").creditPaise).toBe(0);
    expect(row(r, "sales").direction).toBe("Cr");
    expect(row(r, "sales").creditPaise).toBe(200000);
    expect(row(r, "sales").debitPaise).toBe(0);
    expect(row(r, "creditor").direction).toBe("Nil");
  });

  it("totals debit equal to totals credit", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(r.totalDebitPaise).toBe(250000);
    expect(r.totalCreditPaise).toBe(250000);
    expect(r.balanced).toBe(true);
  });

  it("excludes entries after the as-on date", () => {
    const r = computeTrialBalance(ledgers, entries, "2025-12-31");
    expect(row(r, "cash").closingPaise).toBe(300000);
    expect(row(r, "creditor").closingPaise).toBe(-50000);
    expect(r.totalDebitPaise).toBe(300000);
    expect(r.totalCreditPaise).toBe(250000 + 50000 - 200000 + 200000 - 250000 + 250000 - 250000);
    expect(r.totalCreditPaise).toBe(250000);
  });

  it("includes ledgers with no entries and no opening balance", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    const idle = row(r, "idle");
    expect(idle.entryDebitPaise).toBe(0);
    expect(idle.closingPaise).toBe(0);
    expect(idle.direction).toBe("Nil");
  });

  it("handles multiple ledgers in one pass", () => {
    const r = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(r.rows).toHaveLength(4);
    expect(new Set(r.rows.map((x) => x.ledgerId)).size).toBe(4);
  });

  it("never double counts an entry", () => {
    const once = computeTrialBalance(ledgers, entries, "2026-03-31");
    const duplicatedCall = computeTrialBalance(ledgers, entries, "2026-03-31");
    expect(duplicatedCall.rows).toEqual(once.rows);
    const doubled = computeTrialBalance(ledgers, [...entries, ...entries], "2026-03-31");
    expect(row(doubled, "cash").entryDebitPaise).toBe(400000);
    expect(row(once, "cash").entryDebitPaise).toBe(200000);
  });

  it("defaults the as-on date to the financial year end", () => {
    expect(fyEndFor(new Date("2025-06-10T00:00:00Z"))).toBe("2026-03-31");
    expect(fyEndFor(new Date("2026-02-01T00:00:00Z"))).toBe("2026-03-31");
  });
});
