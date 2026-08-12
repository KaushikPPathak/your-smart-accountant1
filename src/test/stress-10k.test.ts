// High-volume stress test.
//
// Real businesses run 5-10k vouchers per financial year. Before we can
// claim the app is production-ready, the core hot paths — snapshot,
// restore, count — MUST stay fast at that scale. This test seeds 10 000
// vouchers (20 000 entries, 10 000 items) into IndexedDB and asserts
// each step completes under a generous but meaningful threshold.
//
// A regression here (e.g. accidental N+1, missing index, unbatched
// transaction) turns this test red long before it reaches a customer.
// Thresholds are set for a CI ubuntu runner; the desktop app is faster.

import { describe, it, expect, beforeAll } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup } from "@/lib/backup";
import { countLive } from "@/lib/integrity";
import { assertVoucherBalanced } from "@/lib/voucher-invariants";

const COMPANY_ID = "stress-co";
const N = 10_000;

// Thresholds — generous headroom over observed timings; tighten as we optimise.
const T_SEED_MS = 15_000;
const T_BACKUP_MS = 5_000;
const T_RESTORE_MS = 15_000;
const T_COUNT_MS = 250;
const T_INVARIANT_MS = 500;

async function wipe() {
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

async function seed(n: number) {
  await offlineDb.cache_companies.put({
    id: COMPANY_ID, name: "Stress Traders", updated_at: new Date().toISOString(),
  });
  await offlineDb.cache_ledgers.bulkPut([
    { id: "led-cash", company_id: COMPANY_ID, name: "Cash", updated_at: new Date().toISOString() },
    { id: "led-sales", company_id: COMPANY_ID, name: "Sales", updated_at: new Date().toISOString() },
  ]);
  await offlineDb.cache_items.put({
    id: "itm-1", company_id: COMPANY_ID, name: "Widget", updated_at: new Date().toISOString(),
  });

  // Batch writes to keep memory + transaction size sane at 10k.
  const BATCH = 1000;
  for (let start = 0; start < n; start += BATCH) {
    const end = Math.min(n, start + BATCH);
    const vs = [];
    const es = [];
    const is = [];
    for (let i = start; i < end; i++) {
      const vid = `v-${i}`;
      vs.push({
        id: vid, company_id: COMPANY_ID, voucher_type: "sales",
        voucher_number: String(i + 1), voucher_date: "2026-07-01",
        total_amount: 100, updated_at: new Date().toISOString(),
      });
      es.push(
        { id: `${vid}-e1`, voucher_id: vid, ledger_id: "led-cash",  company_id: COMPANY_ID, debit_paise: 10000, credit_paise: 0 },
        { id: `${vid}-e2`, voucher_id: vid, ledger_id: "led-sales", company_id: COMPANY_ID, debit_paise: 0,     credit_paise: 10000 },
      );
      is.push({ id: `${vid}-i1`, voucher_id: vid, item_id: "itm-1", company_id: COMPANY_ID, quantity: 1, rate: 100, amount: 100 });
    }
    await offlineDb.cache_vouchers.bulkPut(vs);
    await offlineDb.cache_voucher_entries.bulkPut(es);
    await offlineDb.cache_voucher_items.bulkPut(is);
  }
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`  [stress] ${label}: ${ms.toFixed(0)}ms`);
  return { ms, value };
}

describe(`stress: ${N.toLocaleString()} vouchers`, () => {
  beforeAll(async () => { await wipe(); }, 30_000);

  it("seed → count → snapshot → restore → count all stay within budget", async () => {
    const seedT = await time("seed 10k vouchers", () => seed(N));
    expect(seedT.ms).toBeLessThan(T_SEED_MS);

    const countT1 = await time("countLive after seed", () => countLive(COMPANY_ID));
    expect(countT1.value.vouchers).toBe(N);
    expect(countT1.ms).toBeLessThan(T_COUNT_MS);

    const backupT = await time("buildCompanyBackup", () => buildCompanyBackup(COMPANY_ID));
    expect(backupT.value.vouchers.length).toBe(N);
    expect(backupT.value.voucher_entries.length).toBe(N * 2);
    expect(backupT.ms).toBeLessThan(T_BACKUP_MS);

    // Simulate profile orphan.
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_items.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
      offlineDb.cache_voucher_items.clear(),
    ]);

    const restoreT = await time("restoreCompanyBackup", () =>
      restoreCompanyBackup(COMPANY_ID, backupT.value),
    );
    expect(restoreT.ms).toBeLessThan(T_RESTORE_MS);

    const countT2 = await time("countLive after restore", () => countLive(COMPANY_ID));
    expect(countT2.value.vouchers).toBe(N);
    expect(countT2.ms).toBeLessThan(T_COUNT_MS);

    // Invariant sweep across every voucher — must stay fast.
    const allEntries = await offlineDb.cache_voucher_entries
      .where("company_id").equals(COMPANY_ID).toArray() as {
        voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number;
      }[];
    const byVoucher = new Map<string, typeof allEntries>();
    for (const e of allEntries) {
      const arr = byVoucher.get(e.voucher_id) ?? [];
      arr.push(e);
      byVoucher.set(e.voucher_id, arr);
    }
    const invT = await time(`assertVoucherBalanced × ${byVoucher.size}`, async () => {
      for (const arr of byVoucher.values()) {
        assertVoucherBalanced(arr, { voucherType: "sales", companyId: COMPANY_ID });
      }
    });
    expect(invT.ms).toBeLessThan(T_INVARIANT_MS);
  }, 120_000);
});
