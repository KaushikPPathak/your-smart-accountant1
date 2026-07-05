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
  company_id?: string | null;
  table: string;
  op: "insert" | "update" | "delete" | "rpc" | "custom";
  payload: unknown;
  created_at?: number;
  attempts?: number;
  last_error?: string | null;
  label?: string;
  executor?: string;
  rpc?: string;
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

// All tables are typed loosely as `any` so existing consumers
// (which keep their own row shapes) don't need to be touched.
class OfflineDatabase extends Dexie {
  companies!: Table<any, any>;
  cache_companies!: Table<any, any>;
  cache_company_settings!: Table<any, any>;
  cache_ledgers!: Table<any, any>;
  cache_items!: Table<any, any>;
  cache_account_subgroups!: Table<any, any>;
  cache_ledger_group_mappings!: Table<any, any>;
  cache_account_group_overrides!: Table<any, any>;
  cache_vouchers!: Table<any, any>;
  cache_voucher_entries!: Table<any, any>;
  cache_voucher_items!: Table<any, any>;
  cache_bill_allocations!: Table<any, any>;
  cache_voucher_export_details!: Table<any, any>;
  cache_einvoice_details!: Table<any, any>;
  cache_period_locks!: Table<any, any>;
  cache_bom_templates!: Table<any, any>;
  cache_bom_template_lines!: Table<any, any>;
  cache_recurring_invoices!: Table<any, any>;
  outbox!: Table<any, any>;
  dead_letter!: Table<any, any>;
  sync_cursors!: Table<any, any>;
  account_creds!: Table<any, any>;
  meta!: Table<any, any>;

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
    this.version(2).stores({
      cache_voucher_entries: "id, voucher_id, company_id",
      cache_voucher_items: "id, voucher_id, company_id",
      cache_bill_allocations: "id, company_id, invoice_voucher_id, payment_voucher_id",
    });
    this.version(3).stores({
      // Poison / permanently-failing outbox rows. Kept separate from `outbox`
      // so the drain loop doesn't keep retrying them forever and blocking the
      // queue. Users can inspect / retry / discard from the Data Sync screen.
      dead_letter: "++id, moved_at, company_id, table",
    });
    this.version(4).stores({
      // Additional cache tables so more of the app is usable offline:
      // reprint export invoices, view e-invoice IRN/QR, enforce FY-locks,
      // create manufacturing vouchers from BOM templates, and see recurring
      // invoice schedules. voucher_export_details / einvoice_details use
      // voucher_id as their primary key upstream — mirrored here so the
      // by-id upserts work identically to the sibling cache tables.
      cache_voucher_export_details: "voucher_id, company_id, updated_at",
      cache_einvoice_details: "voucher_id, company_id, updated_at",
      cache_period_locks: "id, company_id, updated_at, return_type, period",
      cache_bom_templates: "id, company_id, output_item_id, updated_at",
      cache_bom_template_lines: "id, template_id, company_id",
      cache_recurring_invoices: "id, company_id, updated_at, is_active",
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
    filter() { return this; },
    equals() { return this; },
    anyOf() { return this; },
    and() { return this; },
    update() { return undefined; },
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
    "cache_vouchers", "cache_voucher_entries", "cache_voucher_items", "cache_bill_allocations",
    "cache_voucher_export_details", "cache_einvoice_details", "cache_period_locks",
    "cache_bom_templates", "cache_bom_template_lines", "cache_recurring_invoices",
    "outbox", "dead_letter", "sync_cursors", "account_creds", "meta",
  ];
  const stub: Record<string, unknown> = {
    async transaction(_mode: string, ...args: unknown[]) {
      const fn = args.find((a) => typeof a === "function") as (() => Promise<unknown>) | undefined;
      return fn ? fn() : undefined;
    },
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
