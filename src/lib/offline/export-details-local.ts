// Export invoice details (currency, FX rate, LUT, weights, shipping) for the
// local-only build. One row per voucher, kept in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";

export async function getExportDetailsLocal(voucherId: string): Promise<Record<string, any> | null> {
  const row: any = await db.cache_voucher_export_details.get(voucherId);
  return row ? { ...row } : null;
}

export async function upsertExportDetailsLocal(voucherId: string, row: Record<string, any>): Promise<void> {
  await db.cache_voucher_export_details.put({
    ...row,
    voucher_id: voucherId,
    updated_at: new Date().toISOString(),
  });
}
