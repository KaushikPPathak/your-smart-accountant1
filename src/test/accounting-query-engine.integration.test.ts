import { describe, expect, it } from "vitest";
import {
  computeBalance,
  resolveCashBankLedger,
  resolveLedgerDeterministic,
  type EngineLedger,
} from "@/lib/ai/accounting-query-engine";

const ledgers: EngineLedger[] = [
  { id: "cash", name: "Cash-in-Hand", group_name: "Cash-in-Hand" },
  { id: "bob", name: "Bank Of Baroda", group_name: "Bank Accounts" },
  { id: "sbi", name: "State Bank Of India", group_name: "Bank Accounts" },
  { id: "hasmukh", name: "Shri Hasmukhbhai A Shah", group_name: "Sundry Debtors" },
  { id: "payal", name: "Miss Payal Hasmukhbhai Shah", group_name: "Sundry Debtors" },
  { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
  { id: "hasmukh2", name: "Hasmukhbhai Shah Enterprises", group_name: "Sundry Creditors" },
];

describe("accounting query engine — deterministic ledger resolution", () => {
  it("resolves a full party name ignoring honorifics", () => {
    const r = resolveLedgerDeterministic(ledgers, "Hasmukhbhai A Shah");
    expect(r.status).toBe("resolved");
    expect(r.status === "resolved" && r.ledger.id).toBe("hasmukh");
  });

  it("resolves a party name written with its honorific", () => {
    const r = resolveLedgerDeterministic(ledgers, "Miss Payal Hasmukhbhai Shah");
    expect(r.status === "resolved" && r.ledger.id).toBe("payal");
  });

  it("ignores trailing question noise like 'balance'", () => {
    const r = resolveLedgerDeterministic(ledgers, "Avni Jenish Shah balance");
    expect(r.status === "resolved" && r.ledger.id).toBe("avni");
  });

  it("reports ambiguity instead of guessing", () => {
    const r = resolveLedgerDeterministic(ledgers, "Hasmukhbhai balance");
    expect(r.status).toBe("ambiguous");
  });

  it("resolves a single word that is the first token of exactly one ledger", () => {
    const liveLike: EngineLedger[] = [
      { id: "hasmukh", name: "Hasmukhbhai A Shah", group_name: "Sundry Debtors" },
      { id: "payal", name: "Miss Payal Hasmukhbhai Shah", group_name: "Sundry Debtors" },
      { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
    ];
    const r = resolveLedgerDeterministic(liveLike, "Hasmukhbhai balance");
    expect(r.status === "resolved" && r.ledger.id).toBe("hasmukh");
  });

  it("never picks a ledger where the word is only a middle token", () => {
    const liveLike: EngineLedger[] = [
      { id: "payal", name: "Miss Payal Hasmukhbhai Shah", group_name: "Sundry Debtors" },
      { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
    ];
    expect(resolveLedgerDeterministic(liveLike, "Hasmukhbhai").status).toBe("not_found");
  });

  it("resolves a two-token query that matches one ledger's name", () => {
    const liveLike: EngineLedger[] = [
      { id: "hasmukh", name: "Hasmukhbhai A Shah", group_name: "Sundry Debtors" },
      { id: "payal", name: "Miss Payal Hasmukhbhai Shah", group_name: "Sundry Debtors" },
    ];
    const r = resolveLedgerDeterministic(liveLike, "Hasmukhbhai Shah balance");
    // Both ledgers contain both tokens, so this must not guess.
    expect(r.status).toBe("ambiguous");
    const r2 = resolveLedgerDeterministic(
      [{ id: "hasmukh", name: "Hasmukhbhai A Shah", group_name: "Sundry Debtors" }],
      "Hasmukhbhai Shah balance",
    );
    expect(r2.status === "resolved" && r2.ledger.id).toBe("hasmukh");
  });

  it("never picks a merely similar ledger", () => {
    expect(resolveLedgerDeterministic(ledgers, "Hasmukh").status).toBe("not_found");
    expect(resolveLedgerDeterministic(ledgers, "Zzz Traders").status).toBe("not_found");
  });
});

describe("accounting query engine — cash and bank resolution", () => {
  it("resolves cash and cash in hand to the cash ledger", () => {
    for (const q of ["cash", "cash in hand", "cash balance"]) {
      const r = resolveCashBankLedger(ledgers, "cash_balance", q);
      expect(r.status === "resolved" && r.ledger.id).toBe("cash");
    }
  });

  it("resolves bank names and their common short forms", () => {
    const cases: Array<[string, string]> = [
      ["Bank of Baroda", "bob"],
      ["BOB", "bob"],
      ["State Bank of India", "sbi"],
      ["SBI", "sbi"],
    ];
    for (const [q, id] of cases) {
      const r = resolveCashBankLedger(ledgers, "bank_balance", q);
      expect(r.status === "resolved" && r.ledger.id).toBe(id);
    }
  });

  it("asks for clarification when 'bank' matches several accounts", () => {
    expect(resolveCashBankLedger(ledgers, "bank_balance", "bank").status).toBe("ambiguous");
  });

  it("does not match an unknown bank", () => {
    expect(resolveCashBankLedger(ledgers, "bank_balance", "Canara Bank").status).toBe("not_found");
  });
});

describe("accounting query engine — balance computation", () => {
  it("computes opening + debit − credit with direction", () => {
    const r = computeBalance(
      { id: "x", name: "X", opening_balance_paise: 1000000, opening_balance_is_debit: true },
      { debitPaise: 500000, creditPaise: 250000, entryCount: 2 },
    );
    expect(r.closingPaise).toBe(1250000);
    expect(r.direction).toBe("Dr");
  });

  it("returns Cr when credits exceed debits", () => {
    const r = computeBalance(
      { id: "x", name: "X", opening_balance_paise: 0, opening_balance_is_debit: true },
      { debitPaise: 0, creditPaise: 5000000, entryCount: 1 },
    );
    expect(r.closingPaise).toBe(-5000000);
    expect(r.direction).toBe("Cr");
  });

  it("treats a credit opening balance as negative", () => {
    const r = computeBalance(
      { id: "x", name: "X", opening_balance_paise: 100000, opening_balance_is_debit: false },
      { debitPaise: 0, creditPaise: 0, entryCount: 0 },
    );
    expect(r.closingPaise).toBe(-100000);
  });
});

describe("accounting query engine — minor spelling tolerance", () => {
  const correct: EngineLedger[] = [
    { id: "madhu", name: "Smt Madhuben Hasmukhbhai Shah", group_name: "Sundry Debtors" },
    { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
  ];
  const typo: EngineLedger[] = [
    { id: "madhu", name: "Smt Madhuben Hasmukhbhai Sha", group_name: "Sundry Debtors" },
    { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
  ];

  it("resolves 'Madhuben balance' against the correctly spelled ledger", () => {
    const r = resolveLedgerDeterministic(correct, "Madhuben balance");
    expect(r.status === "resolved" && r.ledger.id).toBe("madhu");
  });

  it("resolves 'Madhuben balance' when the ledger surname has a typo", () => {
    const r = resolveLedgerDeterministic(typo, "Madhuben balance");
    expect(r.status === "resolved" && r.ledger.id).toBe("madhu");
  });

  it("resolves 'Madhuben Shah balance' against the typo'd ledger name", () => {
    const r = resolveLedgerDeterministic(typo, "Madhuben Shah balance");
    expect(r.status === "resolved" && r.ledger.id).toBe("madhu");
  });

  it("still reports ambiguity when two similar ledgers are plausible", () => {
    const twins: EngineLedger[] = [
      { id: "a", name: "Madhuben Hasmukhbhai Sha", group_name: "Sundry Debtors" },
      { id: "b", name: "Madhuben Hasmukhbhai Shah", group_name: "Sundry Creditors" },
    ];
    expect(resolveLedgerDeterministic(twins, "Madhuben Shah balance").status).toBe("ambiguous");
    expect(resolveLedgerDeterministic(twins, "Madhuben balance").status).toBe("ambiguous");
  });

  it("does not stretch tolerance to a different name", () => {
    expect(resolveLedgerDeterministic(correct, "Madhavi Shah balance").status).toBe("not_found");
  });
});
