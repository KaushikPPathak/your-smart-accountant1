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
  is_synced?: boolean;  // Added to track if local edit matches the cloud
  is_deleted?: boolean; // Added to track soft-deletes while offline
  [k: string]: unknown;
}

// Leave everything below this line exactly as it was in your file...
export type CompanyCacheRow = BaseCacheRow & { name: string };
export type CompanySettingsCacheRow = BaseCacheRow;
export type LedgerCacheRow = BaseCacheRow & { name: string; is_active?: boolean };
export type ItemCacheRow = BaseCacheRow & { name: string; is_active?: boolean };
