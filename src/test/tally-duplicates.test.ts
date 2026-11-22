import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import { postLedgers, postVouchers, type VoucherRecord, type LedgerRecord } from "@/lib/tally-busy-import";
import { getDbInstance } from "@/lib/utils/sys-utils";

const ledgers: LedgerRecord[] = [
  { name: "Cash", group_code: "CASH", group: "CASH", type: "asset", opening: 0 } as unknown as LedgerRecord,
  { name: "Sales", group_code: "SALES", group: "SALES", type: "income", opening: 0 } as unknown as LedgerRecord,
];

function sale(no: string, amount: number): VoucherRecord {
  return {
    vtype: "journal", date: "2026-04-10", voucher_no: no, total: amount,
    entries: [
      { ledger: "Cash", debit: amount, credit: 0 },
      { ledger: "Sales", debit: 0, credit: amount },
    ],
  } as unknown as VoucherRecord;
}

describe("Tally import: repeated voucher numbers", () => {
  const companyId = "dup-company";
  beforeEach(async () => {
    const db = await getDbInstance();
    await db.cache_ledgers.clear();
    await db.cache_vouchers.clear();
    await db.cache_voucher_entries.clear();
    await db.cache_voucher_items.clear();
    await postLedgers(companyId, ledgers);
  });

  it("skips an identical voucher repeated in the same file", async () => {
    const r = await postVouchers(companyId, [sale("7", 500), sale("7", 500)]);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.failed).toEqual([]);
  });

  it("imports a same-number voucher with a different total and flags it", async () => {
    const r = await postVouchers(companyId, [sale("8", 500), sale("8", 900)]);
    expect(r.created).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toMatch(/different total/);
  });

  it("does not flag the same number used by a different party", async () => {
    const other = (no: string, amount: number, party: string): VoucherRecord => ({
      ...sale(no, amount), party,
      entries: [
        { ledger: party, debit: 0, credit: amount },
        { ledger: "Cash", debit: amount, credit: 0 },
      ],
    }) as unknown as VoucherRecord;
    const db = await getDbInstance();
    await postLedgers(companyId, [{ name: "Ali", group_code: "SUNDRY_DEBTORS", group: "SUNDRY_DEBTORS", type: "customer", opening: 0 } as unknown as LedgerRecord]);
    const r = await postVouchers(companyId, [other("11", 400, "Sales"), other("11", 700, "Ali")]);
    expect(r.created).toBe(2);
    expect(r.failed).toEqual([]);
    expect(await db.cache_vouchers.count()).toBe(2);
  });

  it("does not flag a voucher number seen for the first time", async () => {
    const r = await postVouchers(companyId, [sale("9", 300), sale("10", 300)]);
    expect(r.created).toBe(2);
    expect(r.failed).toEqual([]);
  });
});
