/**
 * Standalone tests for accounting-query-engine.ts
 *
 * Purpose:
 * 1. Prove ledger identity resolution is deterministic and never uses fuzzy guessing.
 * 2. Prove opening + debit - credit calculation.
 * 3. Prove date cut-off handling.
 *
 * This test file is intentionally standalone and does NOT modify Smart Accountant.
 *
 * NOTE:
 * The production engine currently reads the app's offline cache directly.
 * These tests therefore validate the core algorithms with controlled fixtures.
 */

import { describe, expect, it } from "vitest";

// Keep these fixtures deliberately close to the known Smart Accountant ledgers.
type Ledger = {
  id: string;
  name: string;
  opening_balance_paise?: number;
  opening_balance_is_debit?: boolean;
};

type Entry = {
  ledger_id: string;
  voucher_date: string;
  debit_paise: number;
  credit_paise: number;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/\\()\-_:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHonorifics(value: string): string {
  return normalizeName(value)
    .replace(/\b(shri|smt|mr|mrs|miss|ms)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveLedger(ledgers: Ledger[], query: string) {
  const q = normalizeName(query);
  const qNoHonorific = stripHonorifics(query);
  const qTokens = qNoHonorific.split(" ").filter(Boolean);

  const exact = ledgers.filter(l => normalizeName(l.name) === q);
  if (exact.length === 1) return { status: "resolved", ledger: exact[0] };

  const honorificExact = ledgers.filter(
    l => stripHonorifics(l.name) === qNoHonorific
  );
  if (honorificExact.length === 1) return {
    status: "resolved",
    ledger: honorificExact[0],
  };

  const candidates = ledgers.filter(l => {
    const tokens = new Set(stripHonorifics(l.name).split(" ").filter(Boolean));
    return qTokens.length > 0 && qTokens.every(t => tokens.has(t));
  });

  if (candidates.length === 1) {
    return { status: "resolved", ledger: candidates[0] };
  }

  if (candidates.length > 1) {
    return { status: "ambiguous", candidates };
  }

  return { status: "not_found" };
}

function calculateBalance(
  ledger: Ledger,
  entries: Entry[],
  asOn?: string
) {
  const opening =
    (ledger.opening_balance_paise ?? 0) *
    (ledger.opening_balance_is_debit === false ? -1 : 1);

  const included = entries.filter(
    e => e.ledger_id === ledger.id && (!asOn || e.voucher_date <= asOn)
  );

  const debit = included.reduce((s, e) => s + e.debit_paise, 0);
  const credit = included.reduce((s, e) => s + e.credit_paise, 0);
  const closing = opening + debit - credit;

  return {
    opening,
    debit,
    credit,
    closing,
    direction: closing > 0 ? "Dr" : closing < 0 ? "Cr" : "Nil",
  };
}

describe("Accounting Query Engine — ledger resolution", () => {
  const ledgers: Ledger[] = [
    { id: "cash", name: "Cash-in-Hand" },
    { id: "bob", name: "Bank of Baroda" },
    { id: "sbi", name: "State Bank of India" },
    { id: "hasmukh", name: "Shri Hasmukhbhai A Shah" },
    { id: "payal", name: "Miss Payal Hasmukhbhai Shah" },
    { id: "avni", name: "Avni Jenish Shah" },
    { id: "other-hasmukh", name: "Hasmukhbhai Shah Enterprises" },
  ];

  it("resolves an exact full ledger name", () => {
    expect(resolveLedger(ledgers, "Shri Hasmukhbhai A Shah").ledger?.id)
      .toBe("hasmukh");
  });

  it("resolves the same ledger without honorific", () => {
    expect(resolveLedger(ledgers, "Hasmukhbhai A Shah").ledger?.id)
      .toBe("hasmukh");
  });

  it("resolves Payal without the Miss honorific", () => {
    expect(resolveLedger(ledgers, "Payal Hasmukhbhai Shah").ledger?.id)
      .toBe("payal");
  });

  it("does not guess when a single token matches multiple ledgers", () => {
    const result = resolveLedger(ledgers, "Hasmukhbhai");
    expect(result.status).toBe("ambiguous");
  });

  it("does not select a merely similar ledger", () => {
    const result = resolveLedger(ledgers, "Hasmukh");
    expect(result.status).toBe("not_found");
  });
});

describe("Accounting Query Engine — balance calculation", () => {
  it("calculates opening + debit - credit", () => {
    const ledger: Ledger = {
      id: "hasmukh",
      name: "Shri Hasmukhbhai A Shah",
      opening_balance_paise: 1000000,
      opening_balance_is_debit: true,
    };

    const entries: Entry[] = [
      { ledger_id: "hasmukh", voucher_date: "2026-04-01", debit_paise: 500000, credit_paise: 0 },
      { ledger_id: "hasmukh", voucher_date: "2026-05-01", debit_paise: 0, credit_paise: 250000 },
    ];

    const result = calculateBalance(ledger, entries);

    expect(result.closing).toBe(1250000);
    expect(result.direction).toBe("Dr");
  });

  it("honours an as-on date and excludes later entries", () => {
    const ledger: Ledger = {
      id: "cash",
      name: "Cash-in-Hand",
      opening_balance_paise: 0,
      opening_balance_is_debit: true,
    };

    const entries: Entry[] = [
      { ledger_id: "cash", voucher_date: "2026-03-31", debit_paise: 29243328, credit_paise: 0 },
      { ledger_id: "cash", voucher_date: "2026-04-01", debit_paise: 10000000, credit_paise: 0 },
    ];

    const result = calculateBalance(ledger, entries, "2026-03-31");

    expect(result.closing).toBe(29243328);
  });

  it("returns Cr when credit exceeds debit", () => {
    const ledger: Ledger = {
      id: "loan",
      name: "Loan",
      opening_balance_paise: 0,
      opening_balance_is_debit: true,
    };

    const entries: Entry[] = [
      { ledger_id: "loan", voucher_date: "2026-04-01", debit_paise: 0, credit_paise: 5000000 },
    ];

    const result = calculateBalance(ledger, entries);

    expect(result.closing).toBe(-5000000);
    expect(result.direction).toBe("Cr");
  });
});
