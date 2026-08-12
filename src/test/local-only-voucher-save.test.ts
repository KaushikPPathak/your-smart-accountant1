import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { runEntryVoucherCreate, runItemVoucherCreate } from "@/lib/offline/voucher-executors";

const COMPANY_ID = "local-co";
const CASH_ID = "cash-ledger";
const PARTY_ID = "party-ledger";
const ITEM_ID = "item-1";

async function resetDb() {
  await Promise.all([
    offlineDb.cache_companies.clear(),
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_items.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.cache_voucher_items.clear(),
    offlineDb.outbox.clear(),
    offlineDb.meta.clear(),
  ]);
  await offlineDb.cache_companies.put({ id: COMPANY_ID, company_id: COMPANY_ID, name: "Local Co", updated_at: "2026-07-07T00:00:00.000Z" });
  await offlineDb.cache_ledgers.bulkPut([
    { id: CASH_ID, company_id: COMPANY_ID, name: "Cash", type: "cash", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
    { id: PARTY_ID, company_id: COMPANY_ID, name: "Customer A", type: "sundry_debtor", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
  ]);
  await offlineDb.cache_items.put({ id: ITEM_ID, company_id: COMPANY_ID, name: "Item A", unit: "NOS", gst_rate: 0, updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true });
}

describe("local-only voucher saves", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await resetDb();
  });

  it("writes entry vouchers directly to IndexedDB without outbox sync", async () => {
    await runEntryVoucherCreate({
      companyId: COMPANY_ID,
      voucherType: "receipt",
      voucherDate: "2026-07-07",
      partyLedgerId: PARTY_ID,
      refNo: "R-1",
      narration: "cash received",
      total: 12_300,
      entries: [
        { ledger_id: CASH_ID, debit_paise: 12_300, credit_paise: 0, narration: null, line_no: 1 },
        { ledger_id: PARTY_ID, debit_paise: 0, credit_paise: 12_300, narration: null, line_no: 2 },
      ],
    });

    const vouchers = await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).toArray();
    const entries = await offlineDb.cache_voucher_entries.where("company_id").equals(COMPANY_ID).toArray();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].voucher_number).toBe("1");
    expect(entries).toHaveLength(2);
    expect(await offlineDb.outbox.count()).toBe(0);
  });

  it("writes item vouchers, item lines and balanced postings locally", async () => {
    const result = await runItemVoucherCreate({
      companyId: COMPANY_ID,
      voucherType: "sales",
      voucherDate: "2026-07-07",
      partyId: PARTY_ID,
      refNo: "S-1",
      narration: "sale",
      placeOfSupply: "24",
      interstate: false,
      itcClass: "na",
      itcEligible: true,
      originalVoucherId: null,
      totals: { subtotal_paise: 10_000, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, round_off_paise: 0, total_paise: 10_000 },
      lines: [
        {
          l: { item_id: ITEM_ID, description: "", qty: "1", rate: "100" },
          c: { discount_paise: 0, amount_paise: 10_000, taxable_paise: 10_000, gst_rate: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, total_paise: 10_000 },
        },
      ],
    });

    const voucher = await offlineDb.cache_vouchers.get(result.voucherId);
    const items = await offlineDb.cache_voucher_items.where("voucher_id").equals(result.voucherId).toArray();
    const entries = await offlineDb.cache_voucher_entries.where("voucher_id").equals(result.voucherId).toArray();
    expect(voucher?.voucher_number).toBe("1");
    expect(items).toHaveLength(1);
    expect(entries.reduce((s: number, e: any) => s + e.debit_paise, 0)).toBe(10_000);
    expect(entries.reduce((s: number, e: any) => s + e.credit_paise, 0)).toBe(10_000);
    expect(await offlineDb.outbox.count()).toBe(0);
  });
});