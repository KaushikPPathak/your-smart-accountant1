// Maps book rows (ledgers, items, vouchers and their lines) to sync entries
// and back. The row shapes are the same ones the backup file uses, so a
// packet holds exactly what a backup would hold for that row.
//
// Direction for this step: desktop -> phone, posted data only. Apply order
// matters: masters first, then vouchers, then the lines that point at them.

import type { SyncEntry } from "./sync-protocol";

export const BOOK_TABLES = [
  "ledgers",
  "items",
  "vouchers",
  "voucher_entries",
  "voucher_items",
  "bill_allocations",
] as const;
export type BookTable = (typeof BOOK_TABLES)[number];

export type BookRow = Record<string, unknown> & { id: string };

export class BookPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookPacketError";
  }
}

/** Writes applied rows into local storage. Implemented over IndexedDB in the app. */
export interface BookWriter {
  put(table: BookTable, rows: BookRow[]): Promise<void>;
  remove(table: BookTable, ids: string[]): Promise<void>;
}

const TABLE_SET = new Set<string>(BOOK_TABLES);

function isBookTable(t: unknown): t is BookTable {
  return typeof t === "string" && TABLE_SET.has(t);
}

/** Entries that upsert one row each, in the given order. */
export function bookRowEntries(table: BookTable, rows: BookRow[], companyId: string): SyncEntry[] {
  return rows.map((row) => {
    if (typeof row.id !== "string" || row.id === "") {
      throw new BookPacketError(`Row in ${table} has no id`);
    }
    if (row.company_id !== undefined && row.company_id !== companyId) {
      throw new BookPacketError(`Row ${row.id} belongs to another company`);
    }
    return { kind: "book.put", data: { table, row } };
  });
}

/** Entry that removes one row. Deletes are sent as tombstones, never by omission. */
export function bookDeleteEntry(table: BookTable, id: string): SyncEntry {
  return { kind: "book.delete", data: { table, id } };
}

/**
 * Apply received entries to local storage. Entries are applied in the order
 * they were sent. Anything that is not a valid book entry is rejected before
 * any write for it.
 */
export async function applyBookEntries(
  entries: SyncEntry[],
  writer: BookWriter,
  companyId: string,
): Promise<number> {
  let applied = 0;
  for (const entry of entries) {
    const data = entry.data as { table?: unknown; row?: unknown; id?: unknown } | null;
    if (!data || !isBookTable(data.table)) {
      throw new BookPacketError(`Unknown book table in entry kind ${entry.kind}`);
    }
    if (entry.kind === "book.put") {
      const row = data.row as BookRow | undefined;
      if (!row || typeof row.id !== "string") throw new BookPacketError("Book row has no id");
      if (row.company_id !== undefined && row.company_id !== companyId) {
        throw new BookPacketError(`Row ${row.id} belongs to another company`);
      }
      await writer.put(data.table, [row]);
    } else if (entry.kind === "book.delete") {
      if (typeof data.id !== "string") throw new BookPacketError("Delete has no id");
      await writer.remove(data.table, [data.id]);
    } else {
      throw new BookPacketError(`Unknown entry kind ${entry.kind}`);
    }
    applied++;
  }
  return applied;
}
