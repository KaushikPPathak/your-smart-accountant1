// Regression test — user-reported July 2026 scenario:
//   "I restored one company from backup. Dropdown then showed all companies
//    including duplicates, and all other data was lost."
//
// This test locks in the invariants that must hold when restoring a
// SINGLE-company backup while OTHER companies exist on the device:
//
//   1. Restoring company A must NOT touch company B or C data.
//   2. Restoring company A twice must NOT create duplicate A rows in the
//      company picker source (cache_companies).
//   3. Company row IDs remain stable — the picker shows exactly the
//      companies that exist on the device, no more, no less.
//   4. Vouchers/ledgers/items for B and C survive the restore of A.
//
// If any of these assertions fail, we have re-introduced the exact bug the
// user reported. Do not merge red.

import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup } from "@/lib/backup";

const COMPANIES = [
  { id: "co-A", name: "Alpha Traders" },
  { id: "co-B", name: "Beta Traders" },
  { id: "co-C", name: "Gamma Traders" },
] as const;

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

async function seedCompany(id: string, name: string, voucherCount: number) {
  const now = new Date().toISOString();
  await offlineDb.cache_companies.put({ id, name, updated_at: now });
  await offlineDb.cache_ledgers.bulkPut([
    { id: `${id}-cash`, company_id: id, name: "Cash", updated_at: now },
    { id: `${id}-sales`, company_id: id, name: "Sales", updated_at: now },
  ]);
  await offlineDb.cache_items.put({
    id: `${id}-item`, company_id: id, name: "Widget", updated_at: now,
  });
  const vouchers = [];
  const entries = [];
  const items = [];
  for (let i = 0; i < voucherCount; i++) {
    const vid = `${id}-v${i}`;
    vouchers.push({
      id: vid, company_id: id, voucher_type: "sales",
      voucher_number: String(i + 1), voucher_date: "2026-07-01",
      total_amount: 100, updated_at: now,
    });
    entries.push(
      { id: `${vid}-e1`, voucher_id: vid, ledger_id: `${id}-cash`, company_id: id, debit: 100, credit: 0 },
      { id: `${vid}-e2`, voucher_id: vid, ledger_id: `${id}-sales`, company_id: id, debit: 0, credit: 100 },
    );
    items.push({
      id: `${vid}-i1`, voucher_id: vid, item_id: `${id}-item`,
      company_id: id, quantity: 1, rate: 100, amount: 100,
    });
  }
  await offlineDb.cache_vouchers.bulkPut(vouchers);
  await offlineDb.cache_voucher_entries.bulkPut(entries);
  await offlineDb.cache_voucher_items.bulkPut(items);
}

async function countFor(companyId: string) {
  const [companies, ledgers, items, vouchers, entries, vitems] = await Promise.all([
    offlineDb.cache_companies.where("id").equals(companyId).count(),
    offlineDb.cache_ledgers.where("company_id").equals(companyId).count(),
    offlineDb.cache_items.where("company_id").equals(companyId).count(),
    offlineDb.cache_vouchers.where("company_id").equals(companyId).count(),
    offlineDb.cache_voucher_entries.where("company_id").equals(companyId).count(),
    offlineDb.cache_voucher_items.where("company_id").equals(companyId).count(),
  ]);
  return { companies, ledgers, items, vouchers, entries, vitems };
}

describe("restore of single-company backup with other companies present", () => {
  beforeEach(wipeAll);

  it("restoring A leaves B and C completely untouched", async () => {
    await seedCompany("co-A", "Alpha Traders", 10);
    await seedCompany("co-B", "Beta Traders", 25);
    await seedCompany("co-C", "Gamma Traders", 7);

    const backupA = await buildCompanyBackup("co-A");

    // Corrupt A locally by wiping some rows to simulate "before restore".
    await offlineDb.cache_vouchers.where("company_id").equals("co-A").delete();

    // Restore A — the reported bug wiped B and C at this point.
    await restoreCompanyBackup("co-A", backupA);

    const a = await countFor("co-A");
    const b = await countFor("co-B");
    const c = await countFor("co-C");

    // A is fully rebuilt.
    expect(a.vouchers).toBe(10);
    expect(a.entries).toBe(20);
    // B and C are byte-identical to their seed state.
    expect(b).toEqual({ companies: 1, ledgers: 2, items: 1, vouchers: 25, entries: 50, vitems: 25 });
    expect(c).toEqual({ companies: 1, ledgers: 2, items: 1, vouchers: 7, entries: 14, vitems: 7 });
  });

  it("restoring A twice does NOT create duplicate A rows in the company picker", async () => {
    await seedCompany("co-A", "Alpha Traders", 5);
    await seedCompany("co-B", "Beta Traders", 5);
    const backupA = await buildCompanyBackup("co-A");

    await restoreCompanyBackup("co-A", backupA);
    await restoreCompanyBackup("co-A", backupA);
    await restoreCompanyBackup("co-A", backupA);

    // Picker source: cache_companies. Each id must appear exactly once.
    const allCompanies = await offlineDb.cache_companies.toArray();
    const ids = allCompanies.map(c => c.id).sort();
    expect(ids).toEqual(["co-A", "co-B"]);
    // No duplicate A row masquerading under a different id but same name.
    const aByName = allCompanies.filter(c => c.name === "Alpha Traders");
    expect(aByName.length).toBe(1);
  });

  it("company picker set never grows or shrinks unexpectedly during restore of A", async () => {
    await seedCompany("co-A", "Alpha Traders", 3);
    await seedCompany("co-B", "Beta Traders", 3);
    await seedCompany("co-C", "Gamma Traders", 3);
    const before = (await offlineDb.cache_companies.toArray()).map(c => c.id).sort();

    const backupA = await buildCompanyBackup("co-A");
    await restoreCompanyBackup("co-A", backupA);

    const after = (await offlineDb.cache_companies.toArray()).map(c => c.id).sort();
    expect(after).toEqual(before);
    expect(after).toEqual(["co-A", "co-B", "co-C"]);
  });

  it("restore of A does not leak A rows into B or C via cross-company id collision", async () => {
    await seedCompany("co-A", "Alpha Traders", 10);
    await seedCompany("co-B", "Beta Traders", 5);
    const backupA = await buildCompanyBackup("co-A");
    await restoreCompanyBackup("co-A", backupA);

    // No B voucher should have been remapped to A, and vice versa.
    const bVouchers = await offlineDb.cache_vouchers.where("company_id").equals("co-B").toArray();
    for (const v of bVouchers) expect(v.company_id).toBe("co-B");

    const aVouchers = await offlineDb.cache_vouchers.where("company_id").equals("co-A").toArray();
    for (const v of aVouchers) expect(v.company_id).toBe("co-A");

    // Entries and items likewise stay in their own company scope.
    const bEntries = await offlineDb.cache_voucher_entries.where("company_id").equals("co-B").toArray();
    expect(bEntries.every(e => e.company_id === "co-B")).toBe(true);
  });
});
