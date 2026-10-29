import { describe, it, expect, vi, beforeEach } from "vitest";

const created: any[] = [];
vi.mock("@/lib/offline/voucher-executors", () => ({
  runEntryVoucherCreate: vi.fn(async (snap: any) => { created.push(snap); }),
}));
vi.mock("@/lib/offline/cache-read", () => ({
  readLedgers: vi.fn(async () => [
    { id: "bank", name: "BANK OF BARODA", type: "bank" },
    { id: "rent", name: "Rent Income", type: "income_indirect" },
    { id: "jainam", name: "Jainam Shares", type: "sundry_creditor" },
    { id: "sd", name: "Share Dividend", type: "income_indirect" },
  ]),
  readVouchers: vi.fn(async () => []),
}));

import { executeVoucherAction, detectVoucherAction, parseAmount } from "../voucher-actions";

const base = {
  confidence: 0.9,
  kind: "new" as const,
  draft: {
    intent: "receipt" as const,
    date: "2026-06-15",
    amount: 16500,
    amountPaise: 1650000,
    narration: "rent",
    refNo: "",
    partyLedgerId: "rent",
    cashBankLedgerId: "bank",
    displayDetails: { partyName: "Rent Income", accountName: "BANK OF BARODA" },
  },
};

describe("assistant posting uses the company books path", () => {
  beforeEach(() => { created.length = 0; });

  it("receipt debits the bank and credits the party, through the real executor", async () => {
    const res = await executeVoucherAction(base as any, "co1");
    expect(res.success).toBe(true);
    expect(created).toHaveLength(1);
    const snap = created[0];
    expect(snap.companyId).toBe("co1");
    expect(snap.voucherType).toBe("receipt");
    expect(snap.total).toBe(1650000);
    expect(snap.entries.find((e: any) => e.ledger_id === "bank").debit_paise).toBe(1650000);
    expect(snap.entries.find((e: any) => e.ledger_id === "rent").credit_paise).toBe(1650000);
  });

  it("payment credits the bank and debits the party", async () => {
    created.length = 0;
    const pay = { ...base, draft: { ...base.draft, intent: "payment" as const } };
    await executeVoucherAction(pay as any, "co1");
    const snap = created[0];
    expect(snap.entries.find((e: any) => e.ledger_id === "bank").credit_paise).toBe(1650000);
    expect(snap.entries.find((e: any) => e.ledger_id === "rent").debit_paise).toBe(1650000);
  });

  it("sales are refused in chat instead of saved without item lines", async () => {
    created.length = 0;
    const sale = { ...base, draft: { ...base.draft, intent: "sales" as const } };
    const res = await executeVoucherAction(sale as any, "co1");
    expect(res.success).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("a failing save reports failure, not success", async () => {
    const exec = await import("@/lib/offline/voucher-executors");
    (exec.runEntryVoucherCreate as any).mockRejectedValueOnce(new Error("Date falls in a locked period."));
    const res = await executeVoucherAction(base as any, "co1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("locked period");
  });
});

describe("bank and party are found in the sentence", () => {
  it("payment: bank named after 'from', party after 'paid to'", async () => {
    const a = await detectVoucherAction("Rs 500000 paid to jainam shares on 25/08/2026 cheque no 0001 from bank of baroda", "co1");
    expect(a?.draft.intent).toBe("payment");
    expect(a?.draft.cashBankLedgerId).toBe("bank");
    expect(a?.draft.partyLedgerId).toBe("jainam");
  });
  it("receipt: bank followed by 'via neft' and party after 'from'", async () => {
    const a = await detectVoucherAction("Rs. 44000 received in bank of baroda via neft from Jainam Shares", "co1");
    expect(a?.draft.intent).toBe("receipt");
    expect(a?.draft.cashBankLedgerId).toBe("bank");
    expect(a?.draft.partyLedgerId).toBe("jainam");
  });
});

describe("amount and party read correctly", () => {
  it("reads Indian comma grouping, not the year in the date", () => {
    expect(parseAmount("Rs. 50,0000 received from Jainam Shares on 15/08/2026")).toBe(500000);
    expect(parseAmount("Rs 1,50,000 paid on 01/10/2026")).toBe(150000);
    expect(parseAmount("Rs.500000 paid to jainam shares on 25/08/2026 cheque no 0001")).toBe(500000);
  });
  it("prefers the exact party name over a similar income ledger", async () => {
    const a = await detectVoucherAction("bank of baroda Rs. 50,0000 received from Jainam Shares on 15/08/2026 via neft", "co1");
    expect(a?.draft.partyLedgerId).toBe("jainam");
    expect(a?.draft.amountPaise).toBe(50000000);
  });
});
