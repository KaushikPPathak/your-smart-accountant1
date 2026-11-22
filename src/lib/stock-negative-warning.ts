// Negative stock is allowed on save, with a warning. A trader can sell before a purchase or a
// raw-material conversion has been recorded, so the warning asks for that entry or a stock
// adjustment. Nothing is blocked. Sign rules match the anomaly scan (src/lib/ai/anomalies.ts).

export type StockSign = -1 | 0 | 1;

export function stockSignFor(voucherType: string): StockSign {
  if (voucherType === "sales" || voucherType === "delivery_note" || voucherType === "stock_journal_out") return -1;
  if (voucherType === "purchase" || voucherType === "receipt_note" || voucherType === "stock_journal_in") return 1;
  return 0;
}

export interface NegativeStockWarning { itemId: string; name: string; closing: number }

/**
 * Items that this voucher takes below zero. `opening` and `netBefore` describe the stock before
 * this voucher; `thisVoucher` is the signed quantity this voucher moves per item.
 */
export function itemsGoingNegative(input: {
  opening: Map<string, number>;
  netBefore: Map<string, number>;
  thisVoucher: Map<string, { name: string; qty: number }>;
}): NegativeStockWarning[] {
  const out: NegativeStockWarning[] = [];
  for (const [itemId, move] of input.thisVoucher) {
    if (move.qty >= 0) continue; // only an outflow can take stock below zero
    const closing = (input.opening.get(itemId) ?? 0) + (input.netBefore.get(itemId) ?? 0) + move.qty;
    if (closing < 0) out.push({ itemId, name: move.name, closing });
  }
  return out;
}

/** Opening and movement per item, excluding one voucher (the one being saved, when editing). */
export async function loadStockPosition(companyId: string, excludeVoucherId: string | null) {
  const { offlineDb } = await import("@/lib/offline/db");
  const [items, vouchers, vitems] = await Promise.all([
    offlineDb.cache_items.where("company_id").equals(companyId).toArray(),
    offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray(),
    offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray(),
  ]);
  const typeById = new Map(vouchers.map((v) => [String(v.id), String(v.voucher_type ?? "")]));
  const opening = new Map<string, number>();
  for (const it of items as any[]) opening.set(String(it.id), Number(it.opening_stock_qty ?? 0));
  const netBefore = new Map<string, number>();
  for (const vi of vitems as any[]) {
    if (vi?.is_deleted === true) continue;
    const voucherId = String(vi.voucher_id);
    if (excludeVoucherId && voucherId === excludeVoucherId) continue;
    const sign = stockSignFor(typeById.get(voucherId) ?? "");
    if (sign === 0) continue;
    const itemId = String(vi.item_id ?? "");
    if (!itemId) continue;
    netBefore.set(itemId, (netBefore.get(itemId) ?? 0) + sign * Number(vi.qty ?? 0));
  }
  return { opening, netBefore };
}
