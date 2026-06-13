// Dexie-backed offline cache database.
//
// This module is the single source of truth for IndexedDB tables used by
// the offline subsystem: outbox, credential cache, snapshot cache and
// sync cursors. All consumers import `offlineDb` (named, default, and
// legacy `db` exports kept for backwards-compatibility with dynamic
// importers).
//
// IMPORTANT: When the browser does not support IndexedDB (e.g. private
// mode on some browsers, or a server-rendered context), every operation
// falls back to a safe no-op so the app degrades gracefully instead of
// throwing "Cannot read properties of undefined" runtime errors.

import Dexie, { type Table } from "dexie";

// --- Row types ------------------------------------------------------------

interface BaseCacheRow {
  id: string;
  company_id: string;
  updated_at: string;
  is_synced?: boolean;
  is_deleted?: boolean;
  [k: string]: unknown;
}

export type CompanyCacheRow = BaseCacheRow & { name: string; has_password?: boolean };
export type CompanySettingsCacheRow = BaseCacheRow;
export type LedgerCacheRow = BaseCacheRow & { name: string; is_active?: boolean };
export type ItemCacheRow = BaseCacheRow & { name: string; is_active?: boolean };

export interface OutboxRow {
  id?: number;
  company_id?: string;
  table: string;
  op: "insert" | "update" | "delete" | "rpc" | "custom";
  payload: unknown;
  created_at?: number;
  attempts?: number;
  last_error?: string | null;
  label?: string;
  executor?: string;
}

export interface AccountCredRow {
  username: string;
  user_id: string;
  name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
  cached_at: number;
}

export interface SyncCursorRow {
  key: string;
  company_id: string;
  table: string;
  last_updated_at: string;
  last_run_at: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

// --- Dexie class ----------------------------------------------------------

class OfflineDatabase extends Dexie {
  // Picker / quick-access mirrors used by the start screen
  companies!: Table<CompanyCacheRow, string>;

  // Snapshot caches
  cache_companies!: Table<CompanyCacheRow, string>;
  cache_company_settings!: Table<CompanySettingsCacheRow, string>;
  cache_ledgers!: Table<LedgerCacheRow, string>;
  cache_items!: Table<ItemCacheRow, string>;
  cache_account_subgroups!: Table<BaseCacheRow, string>;
  cache_ledger_group_mappings!: Table<BaseCacheRow, string>;
  cache_account_group_overrides!: Table<BaseCacheRow, string>;
  cache_vouchers!: Table<BaseCacheRow, string>;
  cache_voucher_entries!: Table<BaseCacheRow, string>;
  cache_voucher_items!: Table<BaseCacheRow, string>;

  // Sync plumbing
  outbox!: Table<OutboxRow, number>;
  sync_cursors!: Table<SyncCursorRow, string>;
  account_creds!: Table<AccountCredRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("ym_offline_cache_v3");
    this.version(1).stores({
      companies: "id, name",
      cache_companies: "id, name, updated_at",
      cache_company_settings: "id, company_id, updated_at",
      cache_ledgers: "id, company_id, name, updated_at",
      cache_items: "id, company_id, name, updated_at",
      cache_account_subgroups: "id, company_id, updated_at",
      cache_ledger_group_mappings: "id, company_id, updated_at",
      cache_account_group_overrides: "id, company_id, updated_at",
      cache_vouchers: "id, company_id, updated_at",
      cache_voucher_entries: "id, voucher_id",
      cache_voucher_items: "id, voucher_id",
      outbox: "++id, created_at, company_id, table",
      sync_cursors: "key, company_id, table",
      account_creds: "username, user_id",
      meta: "key",
    });
  }
}

// --- Safe stub for environments without IndexedDB -------------------------

function makeStubTable() {
  const arr: unknown[] = [];
  return {
    async get() { return undefined; },
    async toArray() { return arr; },
    async add() { return 0; },
    async put() { return undefined; },
    async bulkPut() { return undefined; },
    async delete() { return undefined; },
    async clear() { return undefined; },
    async count() { return 0; },
    where() { return this; },
    equals() { return this; },
    anyOf() { return this; },
    and() { return this; },
    orderBy() { return this; },
    sortBy() { return []; },
    first() { return undefined; },
  } as unknown as Table<unknown, unknown>;
}

function makeStubDb(): OfflineDatabase {
  const tableNames = [
    "companies", "cache_companies", "cache_company_settings",
    "cache_ledgers", "cache_items", "cache_account_subgroups",
    "cache_ledger_group_mappings", "cache_account_group_overrides",
    "cache_vouchers", "cache_voucher_entries", "cache_voucher_items",
    "outbox", "sync_cursors", "account_creds", "meta",
  ];
  const stub: Record<string, unknown> = {
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<unknown>) { return fn(); },
  };
  for (const n of tableNames) stub[n] = makeStubTable();
  return stub as unknown as OfflineDatabase;
}

const hasIndexedDb =
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

let _db: OfflineDatabase;
try {
  _db = hasIndexedDb ? new OfflineDatabase() : makeStubDb();
} catch (err) {
  console.warn("Offline DB unavailable, using in-memory stub:", err);
  _db = makeStubDb();
}

export const offlineDb = _db;
export const db = _db;
export default _db;

// --- Helpers --------------------------------------------------------------

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    await offlineDb.meta.put({ key, value });
  } catch {
    /* ignore */
  }
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const row = await offlineDb.meta.get(key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}
