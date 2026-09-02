import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { runEntryVoucherCreate } from "@/lib/offline/voucher-executors";

const COMPANY_ID = "contra-co";
const CASH_ID = "cash-ledger";
const BANK_ID = "bank-ledger";

async function resetDb() {
  await Promise.all([
    offlineDb.cache_companies.clear(),
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.outbox.clear(),
    offlineDb.meta.clear(),
  ]);
  await offlineDb.cache_companies.put({ id: COMPANY_ID, company_id: COMPANY_ID, name: "Contra Co", updated_at: "2026-07-07T00:00:00.000Z" });
  await offlineDb.cache_ledgers.bulkPut([
    { id: CASH_ID, company_id: COMPANY_ID, name: "Cash", type: "cash", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
    { id: BANK_ID, company_id: COMPANY_ID, name: "HDFC Bank", type: "bank", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
  ]);
}

describe("contra voucher", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await resetDb();
  });

  it("posts a balanced cash→bank transfer with no party ledger", async () => {
    await runEntryVoucherCreate({
      companyId: COMPANY_ID,
      voucherType: "contra",
      voucherDate: "2026-07-07",
      partyLedgerId: null,
      refNo: "C-1",
      narration: "cash deposited into bank",
      total: 50_000,
      entries: [
        { ledger_id: CASH_ID, debit_paise: 0, credit_paise: 50_000, narration: null, line_no: 1 },
        { ledger_id: BANK_ID, debit_paise: 50_000, credit_paise: 0, narration: null, line_no: 2 },
      ],
    });

    const vouchers = await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).toArray();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].voucher_type).toBe("contra");
    expect(vouchers[0].party_ledger_id ?? null).toBeNull();

    const entries = await offlineDb.cache_voucher_entries.where("company_id").equals(COMPANY_ID).toArray();
    const dr = entries.reduce((s, e: any) => s + (e.debit_paise ?? 0), 0);
    const cr = entries.reduce((s, e: any) => s + (e.credit_paise ?? 0), 0);
    expect(dr).toBe(50_000);
    expect(cr).toBe(50_000);
  });

  it("numbers contra vouchers in their own series", async () => {
    for (let i = 0; i < 2; i++) {
      await runEntryVoucherCreate({
        companyId: COMPANY_ID,
        voucherType: "contra",
        voucherDate: "2026-07-07",
        partyLedgerId: null,
        refNo: `C-${i}`,
        narration: "",
        total: 1_000,
        entries: [
          { ledger_id: CASH_ID, debit_paise: 0, credit_paise: 1_000, narration: null, line_no: 1 },
          { ledger_id: BANK_ID, debit_paise: 1_000, credit_paise: 0, narration: null, line_no: 2 },
        ],
      });
    }
    const numbers = (await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).toArray())
      .map((v: any) => v.voucher_number)
      .sort();
    expect(numbers).toEqual(["1", "2"]);
  });
});
