// Verifies the exact user scenario: create a voucher OFFLINE in local-only
// mode, then "go online" — the sync worker tick must NOT wipe or replace
// local data. Nothing should get pushed to the cloud, and the previously
// saved voucher must remain intact and visible.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { runItemVoucherCreate } from "@/lib/offline/voucher-executors";
import { drainOutbox, materializeLocalOnlyOutbox } from "@/lib/offline/outbox";

const COMPANY_ID = "co-flip";
const CASH_ID = "cash-flip";
const PARTY_ID = "party-flip";
const ITEM_ID = "item-flip";

async function seed() {
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
  await offlineDb.cache_companies.put({ id: COMPANY_ID, company_id: COMPANY_ID, name: "Flip Co", updated_at: "2026-07-07T00:00:00.000Z" });
  await offlineDb.cache_ledgers.bulkPut([
    { id: CASH_ID, company_id: COMPANY_ID, name: "Cash", type: "cash", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
    { id: PARTY_ID, company_id: COMPANY_ID, name: "Customer B", type: "sundry_debtor", updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true },
  ]);
  await offlineDb.cache_items.put({ id: ITEM_ID, company_id: COMPANY_ID, name: "Item B", unit: "NOS", gst_rate: 0, updated_at: "2026-07-07T00:00:00.000Z", is_deleted: false, is_active: true });
}

describe("switching offline → online in local-only mode", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await seed();
  });

  it("keeps offline-entered vouchers intact after going online, and never pushes", async () => {
    // Create voucher while "offline" in local-only mode.
    const { voucherId } = await runItemVoucherCreate({
      companyId: COMPANY_ID,
      voucherType: "sales",
      voucherDate: "2026-07-07",
      partyId: PARTY_ID,
      refNo: "S-flip",
      narration: "offline sale",
      placeOfSupply: "24",
      interstate: false,
      itcClass: "na",
      itcEligible: true,
      originalVoucherId: null,
      totals: { subtotal_paise: 5_000, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, round_off_paise: 0, total_paise: 5_000 },
      lines: [
        { l: { item_id: ITEM_ID, description: "", qty: "1", rate: "50" },
          c: { discount_paise: 0, amount_paise: 5_000, taxable_paise: 5_000, gst_rate: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, total_paise: 5_000 } },
      ],
    });

    // Snapshot local state before "going online".
    const before = await offlineDb.cache_vouchers.get(voucherId);
    expect(before?.voucher_number).toBe("1");

    // Simulate going online: navigator.onLine flip + spy on fetch.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValue(
      new Response("{}", { status: 200 }) as never,
    );

    // Both paths that could push/pull in a sync tick.
    const push = await drainOutbox();
    const materialize = await materializeLocalOnlyOutbox();

    // Nothing pushed to the network — local-only guard holds.
    expect(push).toEqual({ pushed: 0, failed: 0, poisoned: 0 });
    expect(materialize.failed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Voucher is still present and unchanged.
    const after = await offlineDb.cache_vouchers.get(voucherId);
    expect(after).toBeDefined();
    expect(after?.voucher_number).toBe(before?.voucher_number);
    expect(after?.total_paise).toBe(5_000);
    expect(await offlineDb.cache_voucher_items.where("voucher_id").equals(voucherId).count()).toBe(1);
    expect(await offlineDb.cache_voucher_entries.where("voucher_id").equals(voucherId).count()).toBe(2);

    fetchSpy.mockRestore();
  });
});
