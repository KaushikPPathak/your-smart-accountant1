import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { mergeLedgersLocal, renumberVouchersLocal } from "@/lib/offline/housekeeping-local";

const CO = "hk-co";

describe("housekeeping local writes", () => {
  beforeEach(async () => {
    await Promise.all([
      db.cache_ledgers.clear(),
      db.cache_vouchers.clear(),
      db.cache_voucher_entries.clear(),
      db.cache_bill_allocations.clear(),
    ]);
    await db.cache_ledgers.bulkPut([
      { id: "L-src", company_id: CO, name: "Old Name", is_active: true, opening_balance_paise: 10000, opening_balance_is_debit: true },
      { id: "L-tgt", company_id: CO, name: "New Name", is_active: true, opening_balance_paise: 2500, opening_balance_is_debit: false },
    ]);
    await db.cache_vouchers.bulkPut([
      { id: "V1", company_id: CO, voucher_number: "S/1", voucher_type: "sales", party_ledger_id: "L-src", voucher_date: "2026-04-01" },
      { id: "V2", company_id: CO, voucher_number: "S/2", voucher_type: "sales", party_ledger_id: "L-other", voucher_date: "2026-04-02" },
    ]);
    await db.cache_voucher_entries.bulkPut([
      { id: "E1", voucher_id: "V1", company_id: CO, ledger_id: "L-src", debit_paise: 100, credit_paise: 0 },
      { id: "E2", voucher_id: "V1", company_id: CO, ledger_id: "L-x", debit_paise: 0, credit_paise: 100 },
    ]);
    await db.cache_bill_allocations.bulkPut([
      { id: "B1", company_id: CO, ledger_id: "L-src", invoice_voucher_id: "V1", payment_voucher_id: "V2" },
    ]);
  });

  it("moves references to the target, combines openings, and deactivates the source", async () => {
    await mergeLedgersLocal(CO, "L-src", "L-tgt");

    expect((await db.cache_voucher_entries.get("E1"))?.ledger_id).toBe("L-tgt");
    expect((await db.cache_voucher_entries.get("E2"))?.ledger_id).toBe("L-x");
    expect((await db.cache_vouchers.get("V1"))?.party_ledger_id).toBe("L-tgt");
    expect((await db.cache_vouchers.get("V2"))?.party_ledger_id).toBe("L-other");
    expect((await db.cache_bill_allocations.get("B1"))?.ledger_id).toBe("L-tgt");

    // Debit 100.00 + credit 25.00 = net debit 75.00
    const tgt: any = await db.cache_ledgers.get("L-tgt");
    expect(tgt.opening_balance_paise).toBe(7500);
    expect(tgt.opening_balance_is_debit).toBe(true);

    const src: any = await db.cache_ledgers.get("L-src");
    expect(src.is_active).toBe(false);
  });

  it("refuses to merge a ledger into itself and leaves data alone", async () => {
    await expect(mergeLedgersLocal(CO, "L-src", "L-src")).rejects.toThrow();
    expect((await db.cache_ledgers.get("L-src"))?.is_active).toBe(true);
  });

  it("renumbers vouchers locally", async () => {
    await renumberVouchersLocal(CO, [
      { id: "V1", voucher_number: "INV/0001" },
      { id: "V2", voucher_number: "INV/0002" },
    ]);
    expect((await db.cache_vouchers.get("V1"))?.voucher_number).toBe("INV/0001");
    expect((await db.cache_vouchers.get("V2"))?.voucher_number).toBe("INV/0002");
  });
});
