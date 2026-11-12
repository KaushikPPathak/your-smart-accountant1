import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { runEntryVoucherCreate } from "@/lib/offline/voucher-executors";

const COMPANY_ID = "scope-co";
const CASH_ID = "cash-l";
const PARTY_ID = "party-l";

function receipt(voucherDate: string) {
  return {
    companyId: COMPANY_ID,
    voucherType: "receipt" as const,
    voucherDate,
    partyLedgerId: PARTY_ID,
    refNo: "",
    narration: "",
    total: 1000,
    entries: [
      { ledger_id: CASH_ID, debit_paise: 1000, credit_paise: 0, narration: null, line_no: 1 },
      { ledger_id: PARTY_ID, debit_paise: 0, credit_paise: 1000, narration: null, line_no: 2 },
    ],
  };
}

describe("voucher number clash check is scope-aware", () => {
  beforeEach(async () => {
    await Promise.all([
      offlineDb.cache_companies.clear(),
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
      offlineDb.cache_bill_allocations.clear(),
      offlineDb.outbox.clear(),
      offlineDb.meta.clear(),
    ]);
    await offlineDb.cache_companies.put({ id: COMPANY_ID, company_id: COMPANY_ID, name: "Scope Co", financial_year_start: "2026-04-01", updated_at: "2026-07-07T00:00:00.000Z" });
    await offlineDb.cache_ledgers.bulkPut([
      { id: CASH_ID, company_id: COMPANY_ID, name: "Cash", type: "cash", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
      { id: PARTY_ID, company_id: COMPANY_ID, name: "Party", type: "sundry_debtor", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
    ]);
  });

  it("auto numbers continue within the same period", async () => {
    await runEntryVoucherCreate(receipt("2026-07-07"));
    await runEntryVoucherCreate(receipt("2026-07-08"));
    const nums = (await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).toArray())
      .map((v) => String(v.voucher_number)).sort();
    expect(nums).toEqual(["1", "2"]);
  });

  it("a number used in another month does not block a monthly-numbered save", async () => {
    const MONTHLY = "monthly-co";
    await offlineDb.cache_companies.put({ id: MONTHLY, company_id: MONTHLY, name: "Monthly Co", financial_year_start: "2026-04-01", updated_at: "2026-07-07T00:00:00.000Z" });
    await offlineDb.cache_ledgers.bulkPut([
      { id: "m-cash", company_id: MONTHLY, name: "Cash", type: "cash", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
      { id: "m-party", company_id: MONTHLY, name: "Party", type: "sundry_debtor", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
    ]);
    await offlineDb.meta.put({ key: `voucher_prefs:${MONTHLY}`, value: { rules: { receipt: { reset: "monthly" } } } } as never);
    const mk = (d: string) => ({ ...receipt(d), companyId: MONTHLY, entries: receipt(d).entries.map((e) => ({ ...e, ledger_id: e.ledger_id === CASH_ID ? "m-cash" : "m-party" })), partyLedgerId: "m-party" });
    await runEntryVoucherCreate(mk("2026-07-07"));
    await expect(runEntryVoucherCreate(mk("2026-08-03"))).resolves.not.toThrow();
    const nums = (await offlineDb.cache_vouchers.where("company_id").equals(MONTHLY).toArray()).map((v) => String(v.voucher_number));
    expect(nums.sort()).toEqual(["1", "1"]);
  });
});
