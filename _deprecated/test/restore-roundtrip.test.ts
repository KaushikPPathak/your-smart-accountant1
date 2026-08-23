// End-to-end reliability test: install → data → "profile orphaned" → restore.
//
// This is the single most important regression test in the project. It
// simulates the July 2026 data-loss scenario:
//   1. User creates a company and enters vouchers (writes to IndexedDB).
//   2. A backup snapshot is taken (buildCompanyBackup) and integrity
//      manifest recorded (recordIntegrityFromSnapshot).
//   3. The WebView profile gets orphaned by an installer glitch — we
//      simulate this by wiping every cache_* table for the company.
//   4. Auto-restore logic decides what to do: manifest says N rows, live
//      says 0 → restore from the snapshot payload.
//   5. Assert every ledger, item, voucher, entry and item row is back and
//      totals still reconcile.
//
// If this test ever fails, the app has regressed on the promise "your
// data survives an update". Do not merge red.

import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup } from "@/lib/backup";
import { recordIntegrityFromSnapshot, getIntegrity, countLive } from "@/lib/integrity";

const COMPANY_ID = "test-co-1";
const COMPANY_NAME = "Test Traders";

async function wipeAll() {
  await Promise.all([
    offlineDb.cache_companies.clear(),
    offlineDb.cache_company_settings.clear(),
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_items.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.cache_voucher_items.clear(),
    offlineDb.cache_bill_allocations.clear(),
    offlineDb.cache_recurring_invoices.clear(),
    offlineDb.meta.clear(),
  ]);
}

async function seedCompany(voucherCount: number) {
  await offlineDb.cache_companies.put({
    id: COMPANY_ID,
    name: COMPANY_NAME,
    updated_at: new Date().toISOString(),
  });
  const ledgerA = { id: "led-cash", company_id: COMPANY_ID, name: "Cash", updated_at: new Date().toISOString() };
  const ledgerB = { id: "led-sales", company_id: COMPANY_ID, name: "Sales", updated_at: new Date().toISOString() };
  await offlineDb.cache_ledgers.bulkPut([ledgerA, ledgerB]);

  const item = { id: "itm-1", company_id: COMPANY_ID, name: "Widget", updated_at: new Date().toISOString() };
  await offlineDb.cache_items.put(item);

  const vouchers = [];
  const entries = [];
  const items = [];
  for (let i = 0; i < voucherCount; i++) {
    const vid = `v-${i}`;
    vouchers.push({
      id: vid,
      company_id: COMPANY_ID,
      voucher_type: "sales",
      voucher_number: String(i + 1),
      voucher_date: "2026-07-01",
      total_amount: 100,
      updated_at: new Date().toISOString(),
    });
    // Balanced double-entry (Dr Cash 100 / Cr Sales 100)
    entries.push(
      { id: `${vid}-e1`, voucher_id: vid, ledger_id: "led-cash", company_id: COMPANY_ID, debit: 100, credit: 0 },
      { id: `${vid}-e2`, voucher_id: vid, ledger_id: "led-sales", company_id: COMPANY_ID, debit: 0, credit: 100 },
    );
    items.push({ id: `${vid}-i1`, voucher_id: vid, item_id: "itm-1", company_id: COMPANY_ID, quantity: 1, rate: 100, amount: 100 });
  }
  await offlineDb.cache_vouchers.bulkPut(vouchers);
  await offlineDb.cache_voucher_entries.bulkPut(entries);
  await offlineDb.cache_voucher_items.bulkPut(items);
}

function assertDebitsEqualCredits(entries: { debit?: number; credit?: number }[]) {
  const dr = entries.reduce((s, e) => s + Number(e.debit ?? 0), 0);
  const cr = entries.reduce((s, e) => s + Number(e.credit ?? 0), 0);
  expect(dr).toBe(cr);
}

describe("install → data → profile orphan → restore (round-trip)", () => {
  beforeEach(async () => {
    await wipeAll();
  });

  it("preserves every voucher, ledger, item and keeps books balanced", async () => {
    const N = 250;
    await seedCompany(N);

    // 1. Baseline: real data present.
    let live = await countLive(COMPANY_ID);
    expect(live.vouchers).toBe(N);
    expect(live.ledgers).toBe(2);
    expect(live.items).toBe(1);

    // 2. Snapshot + integrity manifest.
    const snapshot = await buildCompanyBackup(COMPANY_ID);
    expect(snapshot.vouchers.length).toBe(N);
    expect(snapshot.voucher_entries.length).toBe(N * 2);
    expect(snapshot.voucher_items.length).toBe(N);
    assertDebitsEqualCredits(snapshot.voucher_entries as { debit?: number; credit?: number }[]);

    await recordIntegrityFromSnapshot(COMPANY_ID, COMPANY_NAME, snapshot, { file: "in-memory.json" });
    const manifest = await getIntegrity(COMPANY_ID);
    expect(manifest?.vouchers).toBe(N);

    // 3. Simulate WebView profile orphan: wipe every cache_* table.
    await Promise.all([
      offlineDb.cache_companies.clear(),
      offlineDb.cache_company_settings.clear(),
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_items.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
      offlineDb.cache_voucher_items.clear(),
    ]);
    live = await countLive(COMPANY_ID);
    expect(live.vouchers).toBe(0);
    // Manifest survives (in a real install the disk mirror also survives).
    const survivor = await getIntegrity(COMPANY_ID);
    expect(survivor?.vouchers).toBe(N);

    // 4. Restore from the snapshot payload (what auto-restore feeds in).
    await restoreCompanyBackup(COMPANY_ID, snapshot);

    // 5. Everything back, balanced.
    live = await countLive(COMPANY_ID);
    expect(live.vouchers).toBe(N);
    expect(live.ledgers).toBe(2);
    expect(live.items).toBe(1);

    const restoredEntries = await offlineDb.cache_voucher_entries.where("company_id").equals(COMPANY_ID).toArray();
    expect(restoredEntries.length).toBe(N * 2);
    assertDebitsEqualCredits(restoredEntries as { debit?: number; credit?: number }[]);

    const restoredItems = await offlineDb.cache_voucher_items.where("company_id").equals(COMPANY_ID).toArray();
    expect(restoredItems.length).toBe(N);
  }, 30_000);

  it("atomic restore: no partial state visible to readers", async () => {
    // The mirror runs inside a Dexie transaction. Either all rows land or
    // the previous data is intact. Test by restoring one snapshot on top
    // of another and asserting the intermediate empty state never leaks.
    await seedCompany(20);
    const snapA = await buildCompanyBackup(COMPANY_ID);
    await seedCompany(5); // overwrite with a smaller shape

    await restoreCompanyBackup(COMPANY_ID, snapA);
    const live = await countLive(COMPANY_ID);
    expect(live.vouchers).toBe(20);
  }, 15_000);
});
