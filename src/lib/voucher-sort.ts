/**
 * Voucher ordering rule (applied EVERYWHERE — books, registers, ledgers,
 * day-book, dashboard, voucher list, bank, GST returns):
 *   1. by voucher_date ascending  (or descending where the screen demands)
 *   2. tiebreaker: voucher_number compared NUMERICALLY
 *
 * Without this, Postgres / JS sort voucher_number as text — so "10" lands
 * before "2" and an edited voucher with a higher number appears at the
 * "wrong" place in chronological listings. Always run lists through these
 * helpers after fetching from Supabase, regardless of what `.order()` was
 * passed to the query.
 */

export function vchSortKey(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseInt(String(s).replace(/\D+/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

interface DateAndNumber {
  voucher_date: string;
  voucher_number: string;
}

/** Sort a flat array of voucher rows in place (date asc, number numeric asc). */
export function sortVouchersAsc<T extends DateAndNumber>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? -1 : 1;
    return vchSortKey(a.voucher_number) - vchSortKey(b.voucher_number);
  });
}

/** Sort descending (most recent first) — for "Recent vouchers" UIs. */
export function sortVouchersDesc<T extends DateAndNumber>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? 1 : -1;
    return vchSortKey(b.voucher_number) - vchSortKey(a.voucher_number);
  });
}

/**
 * Sort voucher_entries-style rows where the voucher fields live under a
 * nested `vouchers` relation (Supabase `select(...,vouchers!inner(...))`).
 */
interface NestedVoucherRow {
  vouchers: DateAndNumber | null;
}

export function sortEntriesByVoucherAsc<T extends NestedVoucherRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = a.vouchers?.voucher_date ?? "";
    const db = b.vouchers?.voucher_date ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return vchSortKey(a.vouchers?.voucher_number) - vchSortKey(b.vouchers?.voucher_number);
  });
}
