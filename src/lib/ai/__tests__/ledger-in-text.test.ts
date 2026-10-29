import { describe, it, expect } from "vitest";
import { findLedgerNamedInText } from "../voucher-actions";

const L = (id: string, name: string, type: string) => ({ id, name, type }) as any;
const ledgers = [
  L("bank", "BANK OF BARODA", "bank"),
  L("rent", "Rent Income", "income_indirect"),
  L("rentx", "Rent", "income_indirect"),
  L("ani", "Ani Trade Link Pvt Ltd", "sundry_debtor"),
  L("ca", "Ca", "sundry_debtor"),
];
const income = (t: string) => t === "income_indirect" || t === "sundry_debtor";

describe("findLedgerNamedInText", () => {
  it("finds a ledger named without from/to", () => {
    expect(findLedgerNamedInText(ledgers, "RENT INCOME 9500 IN BANK OF BARODA 15/05/2026", income)?.id).toBe("rent");
  });
  it("prefers the longest full name", () => {
    expect(findLedgerNamedInText(ledgers, "rent income 500", income)?.id).toBe("rent");
  });
  it("does not match a name inside another word", () => {
    expect(findLedgerNamedInText(ledgers, "received cash for Pathak", income)).toBeNull();
  });
  it("skips excluded ledgers such as the bank", () => {
    expect(findLedgerNamedInText(ledgers, "bank of baroda 500", undefined, ["bank"])).toBeNull();
  });
});
