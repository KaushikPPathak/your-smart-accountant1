import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { deleteVoucherLocal } from "@/lib/offline/voucher-delete-local";

const CO = "vd-co";

describe("deleteVoucherLocal", () => {
  beforeEach(async () => {
    await Promise.all([
      db.cache_vouchers.clear(),
      db.cache_voucher_entries.clear(),
      db.cache_voucher_items.clear(),
      db.cache_bill_allocations.clear(),
    ]);
    await db.cache_vouchers.bulkPut([
      { id: "V1", company_id: CO, voucher_number: "S/1", voucher_type: "sales" },
      { id: "V2", company_id: CO, voucher_number: "R/1", voucher_type: "receipt" },
    ]);
    await db.cache_voucher_entries.bulkPut([
      { id: "E1", voucher_id: "V1", company_id: CO, ledger_id: "L1" },
      { id: "E2", voucher_id: "V2", company_id: CO, ledger_id: "L2" },
    ]);
    await db.cache_voucher_items.put({ id: "I1", voucher_id: "V1", company_id: CO, item_id: "it" });
    await db.cache_bill_allocations.bulkPut([
      { id: "B1", company_id: CO, invoice_voucher_id: "V1", payment_voucher_id: "V2" },
      { id: "B2", company_id: CO, invoice_voucher_id: "V3", payment_voucher_id: "V4" },
    ]);
  });

  it("removes the voucher, its lines, items and allocations, and nothing else", async () => {
    await deleteVoucherLocal(CO, "V1");

    expect(await db.cache_vouchers.get("V1")).toBeUndefined();
    expect(await db.cache_voucher_entries.get("E1")).toBeUndefined();
    expect(await db.cache_voucher_items.get("I1")).toBeUndefined();
    expect(await db.cache_bill_allocations.get("B1")).toBeUndefined();

    expect(await db.cache_vouchers.get("V2")).toBeDefined();
    expect(await db.cache_voucher_entries.get("E2")).toBeDefined();
    expect(await db.cache_bill_allocations.get("B2")).toBeDefined();
  });
});
