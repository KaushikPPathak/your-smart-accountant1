// Housekeeping writes (merge duplicate ledgers, renumber vouchers) for the
// local-only build. They change only this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { emitDataChange } from "@/lib/ai/cache-events";

/**
 * Moves every reference from `sourceId` to `targetId`, combines the opening
 * balances, and deactivates the source ledger. All-or-nothing.
 */
export async function mergeLedgersLocal(companyId: string, sourceId: string, targetId: string): Promise<void> {
  if (!companyId || !sourceId || !targetId || sourceId === targetId) {
    throw new Error("Pick two different ledgers to merge.");
  }
  const now = new Date().toISOString();
  await db.transaction(
    "rw",
    [db.cache_ledgers, db.cache_voucher_entries, db.cache_vouchers, db.cache_bill_allocations],
    async () => {
      const source: any = await db.cache_ledgers.get(sourceId);
      const target: any = await db.cache_ledgers.get(targetId);
      if (!source || !target) throw new Error("One of the ledgers was not found on this PC.");

      // 1. Re-point voucher lines.
      await db.cache_voucher_entries.filter((r: any) => r.ledger_id === sourceId).modify({ ledger_id: targetId, updated_at: now });
      // 2. Re-point party on vouchers.
      await db.cache_vouchers
        .where("company_id").equals(companyId)
        .filter((v: any) => v.party_ledger_id === sourceId)
        .modify({ party_ledger_id: targetId, updated_at: now });
      // 3. Re-point bill allocations.
      await db.cache_bill_allocations.filter((r: any) => r.ledger_id === sourceId).modify({ ledger_id: targetId, updated_at: now });

      // 4. Combine opening balances (signed sum; debit positive).
      const sSign = source.opening_balance_is_debit ? 1 : -1;
      const tSign = target.opening_balance_is_debit ? 1 : -1;
      const combined = sSign * (Number(source.opening_balance_paise) || 0) + tSign * (Number(target.opening_balance_paise) || 0);
      await db.cache_ledgers.update(targetId, {
        opening_balance_paise: Math.abs(combined),
        opening_balance_is_debit: combined >= 0,
        updated_at: now,
      });

      // 5. Deactivate the source.
      await db.cache_ledgers.update(sourceId, { is_active: false, updated_at: now });
    },
  );
  emitDataChange(companyId, "ledger");
  emitDataChange(companyId, "voucher");
}

/**
 * Applies new voucher numbers. Each update is { id, voucher_number }. Local
 * storage has no unique constraint on numbers, so no temporary pass is needed.
 */
export async function renumberVouchersLocal(
  companyId: string,
  updates: Array<{ id: string; voucher_number: string }>,
): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  await db.transaction("rw", [db.cache_vouchers], async () => {
    for (const u of updates) {
      await db.cache_vouchers.update(u.id, { voucher_number: u.voucher_number, updated_at: now });
    }
  });
  emitDataChange(companyId, "voucher");
}
