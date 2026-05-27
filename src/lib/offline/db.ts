// Local offline store (Dexie / IndexedDB).
//
// This file ONLY declares the schema and exports the Dexie instance.
// Higher-level helpers (cache, outbox, login fallback) live next to it
// and import from here. Keeping the schema in one place makes future
// version bumps straightforward.

import Dexie, { type Table } from "dexie";

// --- Row shapes ------------------------------------------------------------

export interface OutboxRow {
  id?: number;
  op: "insert" | "update" | "delete" | "rpc" | "custom";
  table?: string;
  rpc?: string;
  // For op="custom": registered executor key in voucher-executors registry.
  executor?: string;
  payload: unknown;
  company_id: string | null;
  label?: string; // optional human-readable label for the status drawer
  created_at: number; // epoch ms
  attempts: number;
  last_error: string | null;
}

export interface AccountCredCacheRow {
  // Username is the primary lookup. Lowercased to match the SQL function.
  username: string;
  user_id: string;
  name: string;
  role: string;
  password_hash: string; // bcrypt hash, verified locally with bcryptjs
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
  hash: string | null; // null => no password set; treat as unlocked
  cached_at: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updated_at: number;
}

// --- Dexie instance --------------------------------------------------------

class OfflineDB extends Dexie {
  outbox!: Table<OutboxRow, number>;
  account_creds!: Table<AccountCredCacheRow, string>;
  pin_cache!: Table<PinCacheRow, string>;
  company_pw_cache!: Table<CompanyPasswordCacheRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("smart_accountant_offline");
    this.version(1).stores({
      outbox: "++id, company_id, created_at, op",
      account_creds: "&username, user_id",
      pin_cache: "&user_id",
      company_pw_cache: "&company_id",
      meta: "&key",
    });
  }
}

export const offlineDb = new OfflineDB();

// --- Tiny meta helpers -----------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await offlineDb.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await offlineDb.meta.put({ key, value, updated_at: Date.now() });
}
