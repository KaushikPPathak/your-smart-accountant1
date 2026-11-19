import { describe, expect, it } from "vitest";
import { cashBankVoucherIds, isJournalBookVoucher } from "@/lib/journal-book-scope";

const types = new Map<string, string>([
  ["cash1", "cash"],
  ["bank1", "bank"],
  ["sales1", "sundry_debtor"],
  ["disc1", "indirect_expense"],
  ["disc2", "indirect_income"],
  ["cap1", "capital"],
  ["pl1", "capital"],
]);

const e = (ledger: string, voucher: string) => ({ ledger_id: ledger, vouchers: { id: voucher } });

describe("Journal Book scope", () => {
  const entries = [
    // V1 journal: bank + party -> touches bank, excluded
    e("bank1", "V1"), e("sales1", "V1"),
    // V2 journal: discount allowed + debtor, no cash/bank -> included
    e("disc1", "V2"), e("sales1", "V2"),
    // V3 journal: discount received + creditor-like income, no cash/bank -> included
    e("disc2", "V3"), e("sales1", "V3"),
    // V4 year-end closing: P&L and capital only -> included
    e("pl1", "V4"), e("cap1", "V4"),
    // V5 journal with cash on one leg and expense on another -> excluded
    e("cash1", "V5"), e("disc1", "V5"),
  ];
  const cashBank = cashBankVoucherIds(entries, types);

  it("collects every voucher that touches a cash or bank ledger", () => {
    expect([...cashBank].sort()).toEqual(["V1", "V5"]);
  });

  it("keeps journal vouchers with no cash or bank ledger", () => {
    expect(isJournalBookVoucher("journal", "V2", cashBank)).toBe(true);
    expect(isJournalBookVoucher("journal", "V3", cashBank)).toBe(true);
    expect(isJournalBookVoucher("journal", "V4", cashBank)).toBe(true);
  });

  it("drops journal vouchers that touch cash or bank", () => {
    expect(isJournalBookVoucher("journal", "V1", cashBank)).toBe(false);
    expect(isJournalBookVoucher("journal", "V5", cashBank)).toBe(false);
  });

  it("drops receipt, payment and contra vouchers regardless of ledgers", () => {
    expect(isJournalBookVoucher("receipt", "V2", cashBank)).toBe(false);
    expect(isJournalBookVoucher("payment", "V9", cashBank)).toBe(false);
    expect(isJournalBookVoucher("contra", "V9", cashBank)).toBe(false);
  });

  it("keeps legacy untyped journal rows that have no cash or bank", () => {
    expect(isJournalBookVoucher("", "V2", cashBank)).toBe(true);
  });

  it("treats an unknown ledger as not cash or bank", () => {
    const ids = cashBankVoucherIds([{ ledger_id: "ghost", vouchers: { id: "V7" } }], types);
    expect(ids.size).toBe(0);
  });

  it("keeps a bank charge with split GST in the Bank Book, not the Journal Book", () => {
    const t = new Map(types);
    t.set("bankch", "indirect_expense");
    t.set("icgst", "duties_taxes");
    t.set("isgst", "duties_taxes");
    const gst = [
      { ledger_id: "bankch", vouchers: { id: "BC1" } },
      { ledger_id: "icgst", vouchers: { id: "BC1" } },
      { ledger_id: "isgst", vouchers: { id: "BC1" } },
      { ledger_id: "bank1", vouchers: { id: "BC1" } },
    ];
    const ids = cashBankVoucherIds(gst, t);
    expect(isJournalBookVoucher("journal", "BC1", ids)).toBe(false);
  });

  it("keeps the same charge as a journal when no bank ledger is involved", () => {
    const t = new Map(types);
    t.set("bankch", "indirect_expense");
    t.set("icgst", "duties_taxes");
    t.set("isgst", "duties_taxes");
    t.set("party", "sundry_creditor");
    const accrual = [
      { ledger_id: "bankch", vouchers: { id: "AC1" } },
      { ledger_id: "icgst", vouchers: { id: "AC1" } },
      { ledger_id: "isgst", vouchers: { id: "AC1" } },
      { ledger_id: "party", vouchers: { id: "AC1" } },
    ];
    const ids = cashBankVoucherIds(accrual, t);
    expect(isJournalBookVoucher("journal", "AC1", ids)).toBe(true);
  });
});
