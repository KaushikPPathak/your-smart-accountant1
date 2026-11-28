// Reads one company's book rows from the local IndexedDB cache for sync.
// The table names map to the cache_* tables in src/lib/offline/db.ts.

import { db } from "@/lib/offline/db";
import type { BookReader } from "@/lib/sync/pc-publisher";
import type { BookRow, BookTable } from "@/lib/sync/book-packets";

const CACHE_TABLE: Record<BookTable, string> = {
  ledgers: "cache_ledgers",
  items: "cache_items",
  vouchers: "cache_vouchers",
  voucher_entries: "cache_voucher_entries",
  voucher_items: "cache_voucher_items",
  bill_allocations: "cache_bill_allocations",
};

export const dexieBookReader: BookReader = {
  async read(table: BookTable, companyId: string): Promise<BookRow[]> {
    const t = (db as unknown as Record<string, { filter: (fn: (r: BookRow) => boolean) => { toArray: () => Promise<BookRow[]> } }>)[CACHE_TABLE[table]];
    if (!t) return [];
    // Filtering in memory works whether or not company_id is indexed.
    return t.filter((r) => r.company_id === companyId).toArray();
  },
};
