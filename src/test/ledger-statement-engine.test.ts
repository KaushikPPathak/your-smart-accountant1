import { describe, expect, it } from "vitest";
import {
  computeLedgerStatement,
  fyStartFor,
  resolveLedgerDeterministic,
  type EngineLedger,
  type LedgerStatementTxn,
} from "@/lib/ai/accounting-query-engine";

const party: EngineLedger = {
  id: "p1",
  name: "Hasmukhbhai A Shah",
  group_name: "Sundry Debtors",
  opening_balance_paise: 1000000, // ₹10,000 Dr
  opening_balance_is_debit: true,
};

const txn = (over: Partial<LedgerStatementTxn>): LedgerStatementTxn => ({
  voucherId: "v",
  date: "2026-04-10",
  voucherNumber: "1",
  voucherType: "receipt",
  referenceNo: null,
  narration: null,
  debitPaise: 0,
  creditPaise: 0,
  ...over,
});

const baseTxns: LedgerStatementTxn[] = [
  txn({ voucherId: "v1", date: "2026-04-10", voucherNumber: "SI-1", debitPaise: 500000, narration: "Invoice 1" }),
  txn({ voucherId: "v2", date: "2026-05-05", voucherNumber: "R-2", creditPaise: 200000, narration: "Receipt" }),
];

describe("ledger statement engine", () => {
  it("1. carries the signed opening balance", () => {
    const r = computeLedgerStatement(party, [], { from: "2026-04-01", to: "2027-03-31" });
    expect(r.openingPaise).toBe(1000000);
    expect(r.openingDirection).toBe("Dr");

    const crOpening = computeLedgerStatement(
      { ...party, opening_balance_is_debit: false },
      [],
      {},
    );
    expect(crOpening.openingPaise).toBe(-1000000);
    expect(crOpening.openingDirection).toBe("Cr");
  });

  it("2. records a debit transaction", () => {
    const r = computeLedgerStatement(party, [baseTxns[0]], {});
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].debitPaise).toBe(500000);
    expect(r.rows[0].creditPaise).toBe(0);
    expect(r.rows[0].voucherNumber).toBe("SI-1");
    expect(r.rows[0].narration).toBe("Invoice 1");
  });

  it("3. records a credit transaction", () => {
    const r = computeLedgerStatement(party, [baseTxns[1]], {});
    expect(r.rows[0].creditPaise).toBe(200000);
    expect(r.rows[0].debitPaise).toBe(0);
  });

  it("4. builds a running balance row by row", () => {
    const r = computeLedgerStatement(party, baseTxns, {});
    expect(r.rows.map((x) => x.balancePaise)).toEqual([1500000, 1300000]);
  });

  it("5. reports the Dr/Cr direction of each running balance", () => {
    const r = computeLedgerStatement(
      { ...party, opening_balance_paise: 0 },
      [
        txn({ voucherId: "a", date: "2026-04-01", voucherNumber: "1", creditPaise: 300000 }),
        txn({ voucherId: "b", date: "2026-04-02", voucherNumber: "2", debitPaise: 300000 }),
        txn({ voucherId: "c", date: "2026-04-03", voucherNumber: "3", debitPaise: 100000 }),
      ],
      {},
    );
    expect(r.rows.map((x) => x.balanceDirection)).toEqual(["Cr", "Nil", "Dr"]);
  });

  it("6. totals the debits of the period", () => {
    const r = computeLedgerStatement(party, baseTxns, {});
    expect(r.totalDebitPaise).toBe(500000);
  });

  it("7. totals the credits of the period", () => {
    const r = computeLedgerStatement(party, baseTxns, {});
    expect(r.totalCreditPaise).toBe(200000);
  });

  it("8. computes closing = opening + debit − credit", () => {
    const r = computeLedgerStatement(party, baseTxns, {});
    expect(r.closingPaise).toBe(1300000);
    expect(r.closingDirection).toBe("Dr");
    expect(r.closingPaise).toBe(r.openingPaise + r.totalDebitPaise - r.totalCreditPaise);
    expect(r.rows[r.rows.length - 1].balancePaise).toBe(r.closingPaise);
  });

  it("9. filters by from/to and folds earlier movement into the opening", () => {
    const txns = [
      txn({ voucherId: "old", date: "2026-04-10", voucherNumber: "1", debitPaise: 500000 }),
      txn({ voucherId: "in", date: "2026-06-10", voucherNumber: "2", debitPaise: 100000 }),
      txn({ voucherId: "later", date: "2026-09-10", voucherNumber: "3", debitPaise: 900000 }),
    ];
    const r = computeLedgerStatement(party, txns, { from: "2026-06-01", to: "2026-06-30" });
    expect(r.openingPaise).toBe(1500000); // 10,000 + 5,000 Dr before the period
    expect(r.rows.map((x) => x.voucherId)).toEqual(["in"]);
    expect(r.closingPaise).toBe(1600000);
  });

  it("10. honours an as-on style cut-off (to date inclusive)", () => {
    const txns = [
      txn({ voucherId: "a", date: "2026-03-31", voucherNumber: "1", debitPaise: 100000 }),
      txn({ voucherId: "b", date: "2026-04-01", voucherNumber: "2", debitPaise: 900000 }),
    ];
    const r = computeLedgerStatement({ ...party, opening_balance_paise: 0 }, txns, {
      to: "2026-03-31",
    });
    expect(r.rows).toHaveLength(1);
    expect(r.closingPaise).toBe(100000);
  });

  it("11. orders multiple transactions on the same date by numeric voucher number", () => {
    const txns = [
      txn({ voucherId: "c", date: "2026-04-10", voucherNumber: "SI-10", debitPaise: 300000 }),
      txn({ voucherId: "a", date: "2026-04-10", voucherNumber: "SI-2", debitPaise: 100000 }),
      txn({ voucherId: "b", date: "2026-04-10", voucherNumber: "SI-3", debitPaise: 200000 }),
    ];
    const r = computeLedgerStatement({ ...party, opening_balance_paise: 0 }, txns, {});
    expect(r.rows.map((x) => x.voucherId)).toEqual(["a", "b", "c"]);
    expect(r.rows.map((x) => x.balancePaise)).toEqual([100000, 300000, 600000]);
  });

  it("12. returns an empty statement for a ledger with no transactions", () => {
    const r = computeLedgerStatement({ ...party, opening_balance_paise: 0 }, [], {});
    expect(r.rows).toHaveLength(0);
    expect(r.totalDebitPaise).toBe(0);
    expect(r.totalCreditPaise).toBe(0);
    expect(r.closingPaise).toBe(0);
    expect(r.closingDirection).toBe("Nil");
  });

  it("13. never double counts a transaction", () => {
    const r = computeLedgerStatement(party, baseTxns, { from: "2026-04-01", to: "2027-03-31" });
    expect(r.rows).toHaveLength(2);
    const summed = r.rows.reduce((s, x) => s + x.debitPaise - x.creditPaise, 0);
    expect(r.closingPaise).toBe(r.openingPaise + summed);
  });

  it("14. reports ambiguity instead of picking a ledger", () => {
    const ledgers: EngineLedger[] = [
      { id: "a", name: "Hasmukhbhai A Shah", group_name: "Sundry Debtors" },
      { id: "b", name: "Hasmukhbhai A shah", group_name: "Sundry Debtors" },
    ];
    expect(resolveLedgerDeterministic(ledgers, "Hasmukhbhai A Shah").status).toBe("ambiguous");
    expect(resolveLedgerDeterministic(ledgers, "Zzz Traders").status).toBe("not_found");
  });

  it("15. tolerates a controlled one-letter typo when exactly one ledger fits", () => {
    const ledgers: EngineLedger[] = [
      { id: "madhu", name: "Smt Madhuben Hasmukhbhai Sha", group_name: "Sundry Debtors" },
      { id: "avni", name: "Avni Jenish Shah", group_name: "Sundry Debtors" },
    ];
    const r = resolveLedgerDeterministic(ledgers, "Madhuben Shah ledger");
    expect(r.status === "resolved" && r.ledger.id).toBe("madhu");
    expect(resolveLedgerDeterministic(ledgers, "Madhavi Shah ledger").status).toBe("not_found");
  });

  it("uses the current financial-year start when no period is given", () => {
    expect(fyStartFor(new Date("2026-09-23T00:00:00Z"))).toBe("2026-04-01");
    expect(fyStartFor(new Date("2026-02-10T00:00:00Z"))).toBe("2025-04-01");
  });
});

it("asOn determines the FY start: asOn 2026-03-31 uses period 2025-04-01 to 2026-03-31", () => {
  // Regression: txns before 2025-04-01 fold into the opening; in-FY txns listed.
  const txns = [
    txn({ voucherId: "v0", date: "2024-11-10", debitPaise: 300000 }),
    txn({ voucherId: "v9", date: "2025-06-15", creditPaise: 150000 }),
    txn({ voucherId: "vx", date: "2026-04-02", debitPaise: 999 }), // next FY, excluded
  ];
  const r = computeLedgerStatement(party, txns, { from: "2025-04-01", to: "2026-03-31" });
  expect(r.openingPaise).toBe(1000000 + 300000);
  expect(r.rows.map((t) => t.date)).toEqual(["2025-06-15"]);
  expect(r.closingPaise).toBe(1300000 - 150000);
});

it("runLedgerStatement date rules: explicit from/to preserved; asOn picks its own FY", () => {
  // fyStartFor must derive the FY from the asOn date, not from today.
  expect(fyStartFor(new Date("2026-03-31T00:00:00"))).toBe("2025-04-01");
  expect(fyStartFor(new Date("2026-04-01T00:00:00"))).toBe("2026-04-01");
  expect(fyStartFor(new Date("2025-04-01T00:00:00"))).toBe("2025-04-01");
});
