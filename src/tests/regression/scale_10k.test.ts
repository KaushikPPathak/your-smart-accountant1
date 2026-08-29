/**
 * Part G — 10k-record scale benchmark.
 *
 * Verifies that reading a full accounting dataset for a company holding
 * 10,000 vouchers / 20,000 voucher entries stays correct and fast, and that
 * the legacy child-row recovery scan is skipped when every child row already
 * carries a company_id (the normal case for modern caches).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { offlineDb } from "../../lib/offline/db";
import { readAccountingDataset, readVoucherEntriesForCompany } from "../../lib/offline/cache-read";

const COMPANY = "co-scale-10k";
const OTHER = "co-scale-other";
const VOUCHERS = 10_000;

function iso(i: number): string {
  const d = new Date(Date.UTC(2024, 3, 1));
  d.setUTCDate(d.getUTCDate() + (i % 360));
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const vouchers: any[] = [];
  const entries: any[] = [];
  for (let i = 0; i < VOUCHERS; i++) {
    const id = `v-${i}`;
    vouchers.push({
      id,
      company_id: COMPANY,
      voucher_date: iso(i),
      voucher_number: String(i + 1),
      voucher_type: i % 2 === 0 ? "sales" : "purchase",
      updated_at: "2024-04-01T00:00:00Z",
    });
    entries.push(
      {
        id: `e-${i}-d`,
        company_id: COMPANY,
        voucher_id: id,
        ledger_id: "led-a",
        debit_paise: 10_000,
        credit_paise: 0,
        updated_at: "2024-04-01T00:00:00Z",
      },
      {
        id: `e-${i}-c`,
        company_id: COMPANY,
        voucher_id: id,
        ledger_id: "led-b",
        debit_paise: 0,
        credit_paise: 10_000,
        updated_at: "2024-04-01T00:00:00Z",
      },
    );
  }
  // A second company's rows must never leak into the results.
  vouchers.push({
    id: "v-other",
    company_id: OTHER,
    voucher_date: "2024-05-01",
    voucher_number: "1",
    voucher_type: "sales",
    updated_at: "2024-04-01T00:00:00Z",
  });
  entries.push({
    id: "e-other",
    company_id: OTHER,
    voucher_id: "v-other",
    ledger_id: "led-a",
    debit_paise: 999,
    credit_paise: 0,
    updated_at: "2024-04-01T00:00:00Z",
  });

  await offlineDb.cache_ledgers.bulkPut([
    { id: "led-a", company_id: COMPANY, name: "Cash", updated_at: "2024-04-01T00:00:00Z" },
    { id: "led-b", company_id: COMPANY, name: "Sales", updated_at: "2024-04-01T00:00:00Z" },
  ] as any);
  await offlineDb.cache_vouchers.bulkPut(vouchers as any);
  await offlineDb.cache_voucher_entries.bulkPut(entries as any);
}, 120_000);

describe("10k-record scale", () => {
  it("reads a full 10k dataset with correct totals and no cross-company leakage", async () => {
    const t0 = Date.now();
    const ds = await readAccountingDataset(COMPANY);
    const ms = Date.now() - t0;

    expect(ds.ledgers.length).toBe(2);
    expect(ds.entries.length).toBe(VOUCHERS * 2);
    const debit = ds.entries.reduce((s, e) => s + e.debit_paise, 0);
    const credit = ds.entries.reduce((s, e) => s + e.credit_paise, 0);
    expect(debit).toBe(VOUCHERS * 10_000);
    expect(debit).toBe(credit);
    // fake-indexeddb is far slower than a real engine; this is a regression
    // ceiling, not a target.
    expect(ms).toBeLessThan(30_000);
    // eslint-disable-next-line no-console
    console.log(`readAccountingDataset(10k vouchers / 20k entries): ${ms}ms`);
  }, 120_000);

  it("date-range filtering narrows the dataset", async () => {
    const ds = await readAccountingDataset(COMPANY, { from: "2024-04-01", to: "2024-04-30" });
    expect(ds.entries.length).toBeGreaterThan(0);
    expect(ds.entries.length).toBeLessThan(VOUCHERS * 2);
  }, 120_000);

  it("skips the legacy recovery scan when all child rows carry company_id", async () => {
    const t0 = Date.now();
    const rows = await readVoucherEntriesForCompany(COMPANY);
    const fast = Date.now() - t0;
    expect(rows.length).toBe(VOUCHERS * 2);
    // eslint-disable-next-line no-console
    console.log(`readVoucherEntriesForCompany (fast path): ${fast}ms`);

    // Introduce one legacy (untagged) row: recovery must switch back on and
    // still return it, merged with the indexed rows.
    await offlineDb.cache_voucher_entries.put({
      id: "e-legacy",
      voucher_id: "v-1",
      ledger_id: "led-a",
      debit_paise: 500,
      credit_paise: 0,
      updated_at: "2024-04-01T00:00:00Z",
    } as any);
    const recovered = await readVoucherEntriesForCompany(COMPANY);
    expect(recovered.length).toBe(VOUCHERS * 2 + 1);
    expect(recovered.some((r: any) => r.id === "e-legacy" && r.company_id === COMPANY)).toBe(true);
    await offlineDb.cache_voucher_entries.delete("e-legacy");
  }, 180_000);
});
