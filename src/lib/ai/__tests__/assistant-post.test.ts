import { describe, it, expect, vi, beforeEach } from "vitest";

const created: any[] = [];
vi.mock("@/lib/offline/voucher-executors", () => ({
  runEntryVoucherCreate: vi.fn(async (snap: any) => { created.push(snap); }),
}));
vi.mock("@/lib/offline/cache-read", () => ({
  readLedgers: vi.fn(async () => [
    { id: "bank", name: "BANK OF BARODA", type: "bank" },
    { id: "rent", name: "Rent Income", type: "income_indirect" },
  ]),
  readVouchers: vi.fn(async () => []),
}));

import { executeVoucherAction } from "../voucher-actions";

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
