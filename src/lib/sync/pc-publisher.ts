// PC side of book sync. Works out what changed since the last publish and
// writes it as encrypted outbox batches. Only new, changed and removed rows
// are sent; each row is compared by a digest of its content.
//
// The publish state (batch counter and last-sent digests) is kept per
// company in local storage. If a run fails part-way, the state is not
// advanced past the failure, so the next run sends the same changes again.
// Applying a change twice has no effect, so that is safe.

import { BOOK_TABLES, bookDeleteEntry, bookRowEntries, type BookRow, type BookTable } from "@/lib/sync/book-packets";
import { publishBatch, type SyncEntry } from "@/lib/sync/sync-protocol";
import type { CloudFolder } from "@/lib/sync/cloud-folder";

/** Entries per outbox batch. Keeps each encrypted file a reasonable size. */
export const MAX_ENTRIES_PER_BATCH = 500;

export interface BookReader {
  read(table: BookTable, companyId: string): Promise<BookRow[]>;
}

export interface PublishState {
  /** Last batch number this device wrote. */
  batch: number;
  /** For each table, row id -> digest of the last version that was published. */
  digests: Partial<Record<BookTable, Record<string, string>>>;
}

export const EMPTY_PUBLISH_STATE: PublishState = { batch: 0, digests: {} };

const stateKey = (companyId: string) => `ym_sync_pc_state:${companyId}`;

export function loadPublishState(companyId: string): PublishState {
  try {
    const raw = localStorage.getItem(stateKey(companyId));
    if (!raw) return EMPTY_PUBLISH_STATE;
    const parsed = JSON.parse(raw) as PublishState;
    if (typeof parsed.batch !== "number" || typeof parsed.digests !== "object") return EMPTY_PUBLISH_STATE;
    return parsed;
  } catch {
    return EMPTY_PUBLISH_STATE;
  }
}

export function savePublishState(companyId: string, state: PublishState): void {
  try {
    localStorage.setItem(stateKey(companyId), JSON.stringify(state));
  } catch {
    // Storage full or blocked. The next run re-sends changes, which is safe.
  }
}

/** JSON with keys sorted at every level, so equal rows give equal text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Short SHA-256 digest of a row's content. */
export async function digestRow(row: BookRow): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(row));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface TableChanges {
  entries: SyncEntry[];
  digests: Record<string, string>;
}

/** Compare current rows with the last published digests for one table. */
export async function diffTable(
  table: BookTable,
  rows: BookRow[],
  companyId: string,
  previous: Record<string, string>,
): Promise<TableChanges> {
  const digests: Record<string, string> = {};
  const changed: BookRow[] = [];
  for (const row of rows) {
    const d = await digestRow(row);
    digests[row.id] = d;
    if (previous[row.id] !== d) changed.push(row);
  }
  const entries: SyncEntry[] = bookRowEntries(table, changed, companyId);
  for (const id of Object.keys(previous)) {
    if (!(id in digests)) entries.push(bookDeleteEntry(table, id));
  }
  return { entries, digests };
}

export interface PublishResult {
  state: PublishState;
  entriesSent: number;
  batchesWritten: number;
}

/**
 * Publish everything that changed since the last run. Writes batches of at
 * most MAX_ENTRIES_PER_BATCH entries, in the order the tables are listed.
 */
export async function publishChanges(opts: {
  folder: CloudFolder;
  key: Uint8Array;
  companyId: string;
  deviceId: string;
  reader: BookReader;
  state: PublishState;
}): Promise<PublishResult> {
  const { folder, key, companyId, deviceId, reader } = opts;
  let state: PublishState = { batch: opts.state.batch, digests: { ...opts.state.digests } };

  const allEntries: SyncEntry[] = [];
  const newDigests: PublishState["digests"] = {};
  for (const table of BOOK_TABLES) {
    const rows = await reader.read(table, companyId);
    const changes = await diffTable(table, rows, companyId, state.digests[table] ?? {});
    allEntries.push(...changes.entries);
    newDigests[table] = changes.digests;
  }

  let batchesWritten = 0;
  for (let i = 0; i < allEntries.length; i += MAX_ENTRIES_PER_BATCH) {
    const chunk = allEntries.slice(i, i + MAX_ENTRIES_PER_BATCH);
    const batch = state.batch + 1;
    await publishBatch(folder, key, companyId, deviceId, batch, chunk);
    state = { ...state, batch };
    savePublishState(companyId, state);
    batchesWritten++;
  }

  // Digests move forward only after every batch was written.
  state = { batch: state.batch, digests: newDigests };
  savePublishState(companyId, state);
  return { state, entriesSent: allEntries.length, batchesWritten };
}
