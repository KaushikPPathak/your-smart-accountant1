import { describe, it, expect } from "vitest";
import { resolveAccountLedger } from "@/lib/ai/retrievers";

const ledgers = [
  { id: "1", name: "Cash in hand", group_name: "Cash-in-hand" },
  { id: "2", name: "Bank Of Baroda", group_name: "Bank Accounts" },
  { id: "3", name: "State Bank Of India", group_name: "Bank Accounts" },
  { id: "4", name: "Hasmukhbhai A Shah", group_name: "Sundry Debtors" },
];

describe("resolveAccountLedger", () => {
  it("resolves cash queries to the cash ledger", () => {
    expect(resolveAccountLedger(ledgers, "cash")?.id).toBe("1");
    expect(resolveAccountLedger(ledgers, "cash in hand")?.id).toBe("1");
  });

  it("resolves bank names exactly", () => {
    expect(resolveAccountLedger(ledgers, "Bank of Baroda")?.id).toBe("2");
    expect(resolveAccountLedger(ledgers, "State Bank of India")?.id).toBe("3");
  });

  it("resolves common bank abbreviations", () => {
    expect(resolveAccountLedger(ledgers, "SBI")?.id).toBe("3");
    expect(resolveAccountLedger(ledgers, "BOB")?.id).toBe("2");
  });

  it("does not match a party ledger as a bank account", () => {
    expect(resolveAccountLedger(ledgers, "Hasmukhbhai Shah")).toBeNull();
  });
});
