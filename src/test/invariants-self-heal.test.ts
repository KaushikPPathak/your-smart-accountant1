// Silent invariant enforcement: proves the app self-heals without any
// user-visible "repair" action. Orphan children get swept, and item-voucher
// postings that drift from the stored totals are re-derived on the spot.

import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { enforceLocalInvariants } from "@/lib/offline/invariants";

const CO = "co-inv";
const PARTY = "party-inv";

async function reset() {
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
  await offlineDb.cache_ledgers.bulkPut([
    { id: PARTY, company_id: CO, name: "Customer", type: "sundry_debtor", is_deleted: false, is_active: true, updated_at: "2026-07-07T00:00:00.000Z" },
  ]);
}

describe("silent invariant enforcement", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await reset();
  });

  it("drops orphan posting rows whose parent voucher is gone", async () => {
    // Orphan entry: voucher_id points at a voucher that doesn't exist.
    await offlineDb.cache_voucher_entries.put({
      id: "e-orphan", voucher_id: "ghost", company_id: CO,
      ledger_id: PARTY, debit_paise: 100, credit_paise: 0, line_no: 1,
      narration: null, updated_at: "2026-07-07T00:00:00.000Z",
    });
    await offlineDb.cache_voucher_items.put({
      id: "i-orphan", voucher_id: "ghost", company_id: CO,
      item_id: "x", line_no: 1, qty: 1, rate_paise: 100,
      discount_paise: 0, amount_paise: 100, taxable_paise: 100,
      gst_rate: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
      description: null, updated_at: "2026-07-07T00:00:00.000Z",
    });

    await enforceLocalInvariants({ force: true });

    expect(await offlineDb.cache_voucher_entries.count()).toBe(0);
    expect(await offlineDb.cache_voucher_items.count()).toBe(0);
  });

  it("re-derives item voucher postings when they drift from stored totals", async () => {
    // A sales voucher that says total = 10000 but has NO entries at all —
    // simulates a partial write. Enforcer must rebuild balanced postings.
    await offlineDb.cache_vouchers.put({
      id: "v-1", company_id: CO, voucher_type: "sales",
      voucher_number: "1", voucher_date: "2026-07-07",
      party_ledger_id: PARTY, reference_no: null, narration: null,
      is_interstate: false,
      subtotal_paise: 10_000, cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
      round_off_paise: 0, total_paise: 10_000,
      place_of_supply_code: "24", itc_class: "na", itc_eligible: true,
      original_voucher_id: null, is_deleted: false, is_synced: true,
      created_at: "2026-07-07T00:00:00.000Z", updated_at: "2026-07-07T00:00:00.000Z",
    });

    await enforceLocalInvariants({ force: true });

    const rebuilt = await offlineDb.cache_voucher_entries.where("voucher_id").equals("v-1").toArray();
    expect(rebuilt.length).toBeGreaterThan(0);
    const dr = rebuilt.reduce((s: number, e: any) => s + e.debit_paise, 0);
    const cr = rebuilt.reduce((s: number, e: any) => s + e.credit_paise, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(10_000);
    // Party gets debited for the total in a sales voucher.
    const partyRow = rebuilt.find((r: any) => r.ledger_id === PARTY);
    expect(partyRow?.debit_paise).toBe(10_000);
  });

  it("leaves already-balanced item vouchers alone", async () => {
    await offlineDb.cache_vouchers.put({
      id: "v-good", company_id: CO, voucher_type: "sales",
      voucher_number: "2", voucher_date: "2026-07-07",
      party_ledger_id: PARTY,
      subtotal_paise: 5_000, cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
      round_off_paise: 0, total_paise: 5_000,
      is_interstate: false, itc_class: "na", itc_eligible: true,
      is_deleted: false, is_synced: true,
      created_at: "2026-07-07T00:00:00.000Z", updated_at: "2026-07-07T00:00:00.000Z",
    });
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "keep-1", voucher_id: "v-good", company_id: CO, ledger_id: PARTY, debit_paise: 5_000, credit_paise: 0, line_no: 1, narration: null, updated_at: "2026-07-07T00:00:00.000Z" },
      { id: "keep-2", voucher_id: "v-good", company_id: CO, ledger_id: "sales-led", debit_paise: 0, credit_paise: 5_000, line_no: 2, narration: null, updated_at: "2026-07-07T00:00:00.000Z" },
    ]);

    await enforceLocalInvariants({ force: true });

    const still = await offlineDb.cache_voucher_entries.where("voucher_id").equals("v-good").toArray();
    const ids = still.map((r: any) => r.id).sort();
    expect(ids).toEqual(["keep-1", "keep-2"]);
  });
});
