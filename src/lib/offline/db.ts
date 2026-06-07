// Local offline store (Dexie / IndexedDB).
//
// Schema v2 adds a read-through cache for masters + transactions so the app
// can render data while offline. Cache tables mirror the cloud row shape
// loosely (only the columns we need to render or replay are typed).

import Dexie, { type Table } from "dexie";

// --- Write queue + auth caches (v1) ---------------------------------------

export interface OutboxRow {
  id?: number;
  op: "insert" | "update" | "delete" | "rpc" | "custom";
  table?: string;
  rpc?: string;
  executor?: string;
  payload: unknown;
  company_id: string | null;
  label?: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

export interface AccountCredCacheRow {
  username: string;
  user_id: string;
  name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
  cached_at: number;
}

export interface PinCacheRow {
  user_id: string;
  name: string;
  role: string;
  pin_hash: string;
  is_active: boolean;
  cached_at: number;
}

export interface CompanyPasswordCacheRow {
  company_id: string;
  hash: string | null;
  cached_at: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updated_at: number;
}

// --- Read-through cache (v2) ----------------------------------------------
//
// All cache rows keep the cloud `id` as the primary key and include
// `company_id` + `updated_at` to enable incremental pull and per-company
// filters. Extra columns are kept loose (Record<string, unknown>) so we
// don't need to keep this file in lock-step with the cloud schema.

interface BaseCacheRow {
  id: string;
  company_id: string;
  updated_at: string; // ISO from Postgres
  [k: string]: unknown;
}

export type CompanyCacheRow = BaseCacheRow & { name: string };
export type CompanySettingsCacheRow = BaseCacheRow;
export type LedgerCacheRow = BaseCacheRow & { name: string; is_active?: boolean };
export type ItemCacheRow = BaseCacheRow & { name: string; is_active?: boolean };
export type AccountSubgroupCacheRow = BaseCacheRow & { name: string };
export type LedgerGroupMappingCacheRow = BaseCacheRow & { ledger_id: string };
export type AccountGroupOverrideCacheRow = BaseCacheRow;
export type VoucherCacheRow = BaseCacheRow & {
  voucher_type: string;
  voucher_number: string;
  voucher_date: string;
};
export interface VoucherEntryCacheRow {
  id: string;
  voucher_id: string;
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  line_no?: number;
  [k: string]: unknown;
}
export interface VoucherItemCacheRow {
  id: string;
  voucher_id: string;
  item_id: string;
  qty: number;
  rate_paise: number;
  [k: string]: unknown;
}

// Per-company-per-table high-water mark for incremental pull
export interface SyncCursorRow {
  key: string; // `${company_id}:${table}`
  company_id: string;
  table: string;
  last_updated_at: string; // ISO
  last_run_at: number; // epoch ms
}

// Cached companies workspace list (kept from v1)
export interface CachedCompanyRow {
  id: string;
  name: string;
  has_password: boolean;
  account_id: string;
  company_name?: string;
}

// --- Dexie instance --------------------------------------------------------

class OfflineDB extends Dexie {
  outbox!: Table<OutboxRow, number>;
  account_creds!: Table<AccountCredCacheRow, string>;
  pin_cache!: Table<PinCacheRow, string>;
  company_pw_cache!: Table<CompanyPasswordCacheRow, string>;
  meta!: Table<MetaRow, string>;
  companies!: Table<CachedCompanyRow, string>;

  // v2 read cache
  cache_companies!: Table<CompanyCacheRow, string>;
  cache_company_settings!: Table<CompanySettingsCacheRow, string>;
  cache_ledgers!: Table<LedgerCacheRow, string>;
  cache_items!: Table<ItemCacheRow, string>;
  cache_account_subgroups!: Table<AccountSubgroupCacheRow, string>;
  cache_ledger_group_mappings!: Table<LedgerGroupMappingCacheRow, string>;
  cache_account_group_overrides!: Table<AccountGroupOverrideCacheRow, string>;
  cache_vouchers!: Table<VoucherCacheRow, string>;
  cache_voucher_entries!: Table<VoucherEntryCacheRow, string>;
  cache_voucher_items!: Table<VoucherItemCacheRow, string>;
  sync_cursors!: Table<SyncCursorRow, string>;

  constructor() {
    super("smart_accountant_offline");
    this.version(1).stores({
      outbox: "++id, company_id, created_at, op",
      account_creds: "&username, user_id",
      pin_cache: "&user_id",
      company_pw_cache: "&company_id",
      meta: "&key",
      companies: "&id, account_id",
    });
    this.version(2).stores({
      // keep v1 tables
      outbox: "++id, company_id, created_at, op",
      account_creds: "&username, user_id",
      pin_cache: "&user_id",
      company_pw_cache: "&company_id",
      meta: "&key",
      companies: "&id, account_id",
      // new read cache
      cache_companies: "&id, updated_at",
      cache_company_settings: "&id, company_id, updated_at",
      cache_ledgers: "&id, company_id, updated_at, name",
      cache_items: "&id, company_id, updated_at, name",
      cache_account_subgroups: "&id, company_id, updated_at",
      cache_ledger_group_mappings: "&id, company_id, ledger_id, updated_at",
      cache_account_group_overrides: "&id, company_id, updated_at",
      cache_vouchers: "&id, company_id, voucher_date, voucher_type, updated_at",
      cache_voucher_entries: "&id, voucher_id, ledger_id",
      cache_voucher_items: "&id, voucher_id, item_id",
      sync_cursors: "&key, company_id, table",
    });
  }
}

export const offlineDb = new OfflineDB();
export { offlineDb as db };

// --- Tiny meta helpers -----------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await offlineDb.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await offlineDb.meta.put({ key, value, updated_at: Date.now() });
}
