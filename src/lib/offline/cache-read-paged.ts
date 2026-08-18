import { offlineDb } from "./db";
import { normalizeAll, normalizeVoucher } from "./cache-normalizers";

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

  // 1. Determine which index to use based on the filters
  // Indexes from db.ts:
  // [company_id+voucher_date]
  // [company_id+voucher_type+voucher_date]
  // [company_id+party_id+voucher_date]
  
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

  // 2. Query with pagination using native Dexie/IndexedDB offset/limit
  // We use reverse() because reports usually show newest first (Day Book / Ledger)
  const query = offlineDb.cache_vouchers
    .where(indexName)
    .between(lowerBound, upperBound, true, true)
    .reverse();

  // 3. Count total matching rows for pagination metadata
  // Dexie .count() on a filtered index is much faster than loading all rows
  const totalCount = await query.count();

  // 4. Load only the specific page
  const rows = await query
    .offset(offset)
    .limit(pageSize)
    .toArray();

  // 5. Normalize and return
  return {
    data: normalizeAll(rows, normalizeVoucher),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}
