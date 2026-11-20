// Closing stock for the financial-year close, taken from the same valuation the stock reports use.
// A manual valuation for that date wins; otherwise the costing engine values every item.
import { offlineDb } from "@/lib/offline/db";
import { getManualValuation } from "@/lib/offline/manual-valuation";
import { getValuationMethod } from "@/lib/inventory/valuation-method";
import { resolveInventoryValuation } from "@/lib/inventory/valuation-engine";

export interface SuggestedClosingStock {
  paise: number;
  source: "manual" | "engine";
}

/** Closing stock at `asOfDate` (YYYY-MM-DD), in paise, from the local data. */
export async function suggestClosingStock(companyId: string, asOfDate: string): Promise<SuggestedClosingStock> {
  const manual = await getManualValuation(companyId, asOfDate);
  if (manual !== null) return { paise: manual, source: "manual" };

  const [items, vouchers, voucherItems, method] = await Promise.all([
    offlineDb.cache_items.where("company_id").equals(companyId).toArray(),
    offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray(),
    offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray(),
    getValuationMethod(companyId),
  ]);
  const liveItems = (items as any[]).filter((i) => !i.is_deleted && !i.deleted_at);
  const liveVouchers = (vouchers as any[]).filter((v) => !v.is_deleted && !v.deleted_at && (v.voucher_date ?? "") <= asOfDate);
  const liveVoucherIds = new Set(liveVouchers.map((v) => String(v.id)));
  const liveLines = (voucherItems as any[]).filter((l) => liveVoucherIds.has(String(l.voucher_id)));
  const paise = await resolveInventoryValuation(companyId, asOfDate, liveItems, liveVouchers, liveLines, method);
  return { paise, source: "engine" };
}
