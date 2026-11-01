// Deletes one voucher from this PC's books: its lines, items and bill
// allocations go with it, and the voucher row is removed.
import { offlineDb as db } from "@/lib/offline/db";
import { emitDataChange } from "@/lib/ai/cache-events";

export async function deleteVoucherLocal(companyId: string, voucherId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.cache_voucher_entries, db.cache_voucher_items, db.cache_bill_allocations, db.cache_vouchers],
    async () => {
      await db.cache_voucher_entries.where("voucher_id").equals(voucherId).delete();
      await db.cache_voucher_items.where("voucher_id").equals(voucherId).delete();
      await db.cache_bill_allocations.filter(
        (r: any) => r.invoice_voucher_id === voucherId || r.payment_voucher_id === voucherId,
      ).delete();
      await db.cache_vouchers.delete(voucherId);
    },
  );
  emitDataChange(companyId, "voucher");
}
