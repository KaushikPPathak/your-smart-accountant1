import { offlineDb } from "./db";
import { normalizeAll, normalizeVoucher, normalizeLedger, normalizeItem } from "./cache-normalizers";

export interface PagedReportOptions {
  companyId: string;
  voucherType?: string;
  partyId?: string;
  from?: string; // ISO date
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * High-performance paginated report reader.
 * Uses IndexedDB native cursors and compound indexes to avoid materializing
 * the full dataset into memory.
 */
export async function readVouchersPaged(opts: PagedReportOptions) {
  const { companyId, voucherType, partyId, from, to, page = 1, pageSize = 50 } = opts;
  const offset = (page - 1) * pageSize;

  let indexName = "[company_id+voucher_date]";
  let lowerBound: any[] = [companyId, from || "0000-00-00"];
  let upperBound: any[] = [companyId, to || "9999-99-99"];

  if (voucherType) {
    indexName = "[company_id+voucher_type+voucher_date]";
    lowerBound = [companyId, voucherType, from || "0000-00-00"];
    upperBound = [companyId, voucherType, to || "9999-99-99"];
  } else if (partyId) {
    indexName = "[company_id+party_id+voucher_date]";
    lowerBound = [companyId, partyId, from || "0000-00-00"];
    upperBound = [companyId, partyId, to || "9999-99-99"];
  }

  const query = offlineDb.cache_vouchers
    .where(indexName)
    .between(lowerBound, upperBound, true, true)
    .reverse();

  const totalCount = await query.count();
  const rows = await query
    .offset(offset)
    .limit(pageSize)
    .toArray();

  return {
    data: normalizeAll(rows, normalizeVoucher),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

/**
 * Memory-safe iterator for all voucher entries of a company.
 * Useful for Trial Balance, P&L, etc.
 */
export async function forEachEntry(
  companyId: string, 
  callback: (entry: any) => void
): Promise<void> {
  await offlineDb.cache_voucher_entries
    .where("company_id")
    .equals(companyId)
    .each(callback);
}

/**
 * Memory-safe iterator for all vouchers of a company.
 */
export async function forEachVoucher(
  companyId: string,
  callback: (voucher: any) => void
): Promise<void> {
  await offlineDb.cache_vouchers
    .where("company_id")
    .equals(companyId)
    .each(callback);
}
