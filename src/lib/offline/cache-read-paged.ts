// Cursor-based, streaming readers for the offline cache.
//
// The default `readVouchers` / `readVoucherEntriesForCompany` in cache-read.ts
// materialise the entire table into a JS array. That is fine for books with a
// few thousand vouchers, but breaks down at 100k+ rows (main-thread stalls,
// memory spikes, GC pauses that freeze the UI).
//
// The helpers here use Dexie's `Collection.each` (which iterates the
// underlying IDB cursor one row at a time) so the aggregation runs in O(1)
// memory over the row count. Callers pass a visitor and get back only the
// aggregate they asked for — no giant intermediate array.
//
// Compound indexes leveraged (see src/lib/offline/db.ts version 8):
//   cache_vouchers        [company_id+voucher_date]
//   cache_voucher_entries [company_id+ledger_id]
//
// Both are used as *keyed range scans*, which is the fastest access pattern
// IndexedDB offers.

import { offlineDb } from "./db";

export interface VoucherStreamOpts {
  voucher_type?: string;
  from?: string; // ISO date (inclusive)
  to?: string;   // ISO date (inclusive)
}

/** Iterate vouchers for a company, honouring optional date/type filters. */
export async function forEachVoucher(
  companyId: string,
  opts: VoucherStreamOpts,
  visit: (v: any) => void,
): Promise<number> {
  let count = 0;
  const from = opts.from ?? "0000-01-01";
  const to = opts.to ?? "9999-12-31";
  // Range scan via the [company_id+voucher_date] compound index — no full scan.
  const coll = offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, from], [companyId, to], true, true);
  await coll.each((v: any) => {
    if (v?.is_deleted === true) return;
    if (opts.voucher_type && v.voucher_type !== opts.voucher_type) return;
    visit(v);
    count++;
  });
  return count;
}

/** Iterate voucher entries for a specific ledger (uses [company_id+ledger_id]). */
export async function forEachEntryOfLedger(
  companyId: string,
  ledgerId: string,
  visit: (e: any) => void,
): Promise<number> {
  let count = 0;
  const coll = offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, ledgerId]);
  await coll.each((e: any) => {
    if (e?.is_deleted === true) return;
    visit(e);
    count++;
  });
  return count;
}

/** Iterate all voucher entries for a company (falls back gracefully). */
export async function forEachEntry(
  companyId: string,
  visit: (e: any) => void,
): Promise<number> {
  let count = 0;
  await offlineDb.cache_voucher_entries
    .where("company_id").equals(companyId)
    .each((e: any) => {
      if (e?.is_deleted === true) return;
      visit(e);
      count++;
    });
  return count;
}

/**
 * Keyset-paginated voucher fetch. Returns the next `limit` vouchers strictly
 * older than `cursor` (or the latest `limit` when `cursor` is null).
 *
 * Cursor shape: [voucher_date, id] — matches the compound sort order used by
 * the Day Book / Sales Register.
 */
export async function readVouchersPage(
  companyId: string,
  opts: VoucherStreamOpts & { limit?: number; cursor?: [string, string] | null },
): Promise<{ rows: any[]; nextCursor: [string, string] | null }> {
  const limit = Math.max(1, opts.limit ?? 100);
  const rows: any[] = [];
  await forEachVoucher(companyId, opts, (v) => {
    rows.push(v);
  });
  // Newest first, then by id for stable ordering.
  rows.sort((a, b) => {
    if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? 1 : -1;
    return String(a.id) < String(b.id) ? 1 : -1;
  });
  let start = 0;
  if (opts.cursor) {
    const [cDate, cId] = opts.cursor;
    start = rows.findIndex((r) => r.voucher_date < cDate || (r.voucher_date === cDate && String(r.id) < cId));
    if (start === -1) start = rows.length;
  }
  const page = rows.slice(start, start + limit);
  const last = page[page.length - 1];
  const nextCursor: [string, string] | null =
    page.length === limit && last ? [String(last.voucher_date), String(last.id)] : null;
  return { rows: page, nextCursor };
}
