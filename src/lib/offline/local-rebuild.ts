// Local-only "Rebuild from device" flow.
//
// Unlike rebuildCompanyCache (which nukes cache_* rows and re-pulls from the
// server), this function keeps every source row on-device and only recomputes
// the derived layers: AI semantic index, answer cache, cache-event fanout,
// and the schema-version stamp. Safe to run in local-only mode because it
// never deletes user data.

import { invalidateSemanticIndex, getIndex } from "@/lib/ai/semantic-index";
import { invalidateAnswerCache } from "@/lib/ai/answer-cache";
import { emitDataChange } from "@/lib/ai/cache-events";
import { stampSchemaVersion } from "./schema-version";
import { offlineDb } from "./db";

export interface LocalRebuildResult {
  ledgers: number;
  items: number;
  vouchers: number;
  indexDocs: number;
  answersCleared: boolean;
}

async function safeCount(table: string, companyId: string): Promise<number> {
  const t = (offlineDb as any)[table];
  if (!t) return 0;
  try {
    return await t.where("company_id").equals(companyId).count();
  } catch {
    try {
      return await t.filter((r: any) => r?.company_id === companyId).count();
    } catch {
      return 0;
    }
  }
}

/**
 * Recompute all derived data for `companyId` from local IndexedDB source rows.
 * Does not touch cache_* / voucher / ledger data — only indexes and caches
 * that can be regenerated at any time.
 */
export async function rebuildLocalDerived(companyId: string): Promise<LocalRebuildResult> {
  if (!companyId) throw new Error("No active company.");

  // 1. Drop the cached AI answers for this company (stale numbers, wrong ledgers, etc.).
  invalidateAnswerCache(companyId);

  // 2. Drop the persisted semantic index and rebuild from local ledgers/items.
  invalidateSemanticIndex(companyId);
  const idx = await getIndex(companyId);

  // 3. Fan out change events so any live retriever / balances chip refreshes.
  try { emitDataChange({ kind: "ledger", companyId }); } catch { /* ignore */ }
  try { emitDataChange({ kind: "item", companyId }); } catch { /* ignore */ }
  try { emitDataChange({ kind: "voucher", companyId }); } catch { /* ignore */ }

  // 4. Re-stamp schema version so the "rebuild recommended" badge clears.
  await stampSchemaVersion();

  const [ledgers, items, vouchers] = await Promise.all([
    safeCount("cache_ledgers", companyId),
    safeCount("cache_items", companyId),
    safeCount("cache_vouchers", companyId),
  ]);

  return {
    ledgers,
    items,
    vouchers,
    indexDocs: idx?.docs?.length ?? 0,
    answersCleared: true,
  };
}
