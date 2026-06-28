// Read helpers for the offline cache. Components that need to render while
// offline can call these directly; pair them with the cloud query and pick
// whichever has data (or always prefer cloud while online, falling back to
// cache on error).
//
// Example:
//   const cloud = await supabase.from("ledgers").select("*").eq("company_id", c);
//   if (cloud.error) return readLedgers(c);
//   return cloud.data;

import { offlineDb } from "./db";

export async function readCompanies() {
  return offlineDb.cache_companies.toArray();
}

export async function readCompanySettings(companyId: string) {
  return offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
}

export async function readLedgers(companyId: string) {
  return offlineDb.cache_ledgers.where("company_id").equals(companyId).sortBy("name");
}

export async function readItems(companyId: string) {
  return offlineDb.cache_items.where("company_id").equals(companyId).sortBy("name");
}

export async function readAccountSubgroups(companyId: string) {
  return offlineDb.cache_account_subgroups.where("company_id").equals(companyId).toArray();
}

export async function readLedgerGroupMappings(companyId: string) {
  return offlineDb.cache_ledger_group_mappings.where("company_id").equals(companyId).toArray();
}

export async function readVouchers(companyId: string, opts?: {
  voucher_type?: string;
  from?: string; // ISO date
  to?: string;
}) {
  let coll = offlineDb.cache_vouchers.where("company_id").equals(companyId);
  if (opts?.voucher_type || opts?.from || opts?.to) {
    coll = coll.filter((v) => {
      if (opts.voucher_type && v.voucher_type !== opts.voucher_type) return false;
      if (opts.from && v.voucher_date < opts.from) return false;
      if (opts.to && v.voucher_date > opts.to) return false;
      return true;
    });
  }
  const rows = await coll.toArray();
  return rows.sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : -1));
}

export async function readVoucherEntriesForCompany(companyId: string) {
  const vouchers = await readVouchers(companyId);
  const ids = vouchers.map((v) => v.id).filter(Boolean);
  if (ids.length === 0) return [];
  return offlineDb.cache_voucher_entries.where("voucher_id").anyOf(ids).toArray();
}

export async function readVoucherItemsForCompany(companyId: string) {
  const vouchers = await readVouchers(companyId);
  const ids = vouchers.map((v) => v.id).filter(Boolean);
  if (ids.length === 0) return [];
  return offlineDb.cache_voucher_items.where("voucher_id").anyOf(ids).toArray();
}

export async function readVoucherEntries(voucherId: string) {
  return offlineDb.cache_voucher_entries.where("voucher_id").equals(voucherId).toArray();
}

export async function readVoucherItems(voucherId: string) {
  return offlineDb.cache_voucher_items.where("voucher_id").equals(voucherId).toArray();
}

/** Cache-aware fetch: try the cloud loader; on any error/empty, fall back. */
export async function withCacheFallback<T>(
  cloud: () => Promise<T>,
  cache: () => Promise<T>,
): Promise<T> {
  try {
    return await cloud();
  } catch {
    return await cache();
  }
}
