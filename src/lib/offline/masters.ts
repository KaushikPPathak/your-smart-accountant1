// Offline-aware writes for master tables (ledgers, items) with true bi-directional sync.
//
// Every operation updates the local cache tables first to guarantee total availability,
// stamps it with 'updated_at', and queues the mutation in the outbox. The synchronizer
// pulls down cloud updates incrementally using cursor high-water marks.

import { supabase } from "@/integrations/supabase/client";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { isOnlineNow } from "./online-status";
import { enqueueWrite } from "./outbox";
import {
  upsertCachedLedger,
  upsertCachedItem,
  removeCachedLedger,
  removeCachedItem,
  type CachedLedger,
  type CachedItem,
} from "@/lib/masters-cache";

// Explicitly declare interfaces to strip out top-level import bindings entirely
export interface LedgerCacheRow extends LedgerInsertPayload {
  id: string;
  gst_treatment: string;
  updated_at: string;
  is_synced: boolean;
  is_deleted: boolean;
  is_active?: boolean;
}

export interface ItemCacheRow extends ItemInsertPayload {
  id: string;
  updated_at: string;
  is_synced: boolean;
  is_deleted: boolean;
  is_active?: boolean;
}

function newId(): string {
  return crypto.randomUUID();
}

// Runtime dynamic import resolver to prevent Rollup compilation deadlocks
async function getDbInstance() {
  const module = await import("./db");
  return module.default || module.offlineDb || (module as any).db;
}

/**
 * Robust Bi-Directional Master Synchronizer
 * Evaluates Local vs Remote state using Last-Write-Wins (LWW) timestamp logic.
 */
export async function syncEssentialMasters(companyId: string): Promise<void> {
  if (isLocalOnlyMode()) return;
  if (!isOnlineNow() || !companyId) return;

  const tablesToSync = ["ledgers", "items"] as const;
  const offlineDb = await getDbInstance();

  for (const table of tablesToSync) {
    try {
      const cursorKey = `${companyId}:${table}`;
      const dexieTable = table === "ledgers" ? offlineDb.cache_ledgers : offlineDb.cache_items;

      // 1. Fetch high-water mark cursor positions
      const currentCursor = await offlineDb.sync_cursors.get(cursorKey);
      const lastUpdatedAt = currentCursor?.last_updated_at ?? "1970-01-01T00:00:00.000Z";

      // 2. Fetch cloud deltas modified after our local state position
      const { data: cloudDeltas, error } = await supabase
        .from(table)
        .select("*")
        .eq("company_id", companyId)
        .gt("updated_at", lastUpdatedAt)
        .order("updated_at", { ascending: true });

      if (error) throw error;

      if (cloudDeltas && cloudDeltas.length > 0) {
        let maxUpdatedAt = lastUpdatedAt;

        for (const remote of cloudDeltas) {
          const local = await dexieTable.get(remote.id);

          if (!local) {
            // Unseen entry: Cache immediately
            await dexieTable.put({ ...remote, is_synced: true, is_deleted: false });
          } else {
            const localTime = new Date(local.updated_at || 0).getTime();
            const remoteTime = new Date(remote.updated_at || 0).getTime();

            // Cloud changes overwrite local only if the remote write is newer
            if (remoteTime > localTime) {
              await dexieTable.put({ ...remote, is_synced: true, is_deleted: false });
            }
          }

          if (new Date(remote.updated_at).getTime() > new Date(maxUpdatedAt).getTime()) {
            maxUpdatedAt = remote.updated_at;
          }
        }

        // 3. Commit new high-water mark cursor position
        await offlineDb.sync_cursors.put({
          key: cursorKey,
          company_id: companyId,
          table: table,
          last_updated_at: maxUpdatedAt,
          last_run_at: Date.now(),
        });
      }
    } catch (err) {
      console.error(`Master table synchronization deferred for ${table}: `, err);
    }
  }
}

// ---------- Ledgers ---------------------------------------------------------

export interface LedgerInsertPayload {
  company_id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: any;
  group_code?: string | null;
  subgroup_id?: string | null;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  state_code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  opening_balance_paise?: number;
  opening_balance_is_debit?: boolean;
  credit_limit_paise?: number;
  credit_days?: number;
  // Party master (local-only; drives GST + 43B downstream automations).
  gst_registration_type?: string | null;
  msme_registered?: boolean;
  msme_udyam_no?: string | null;
  msme_classification?: string | null;
}

export interface LedgerRow {
  id: string;
  name: string;
  type: string;
  state_code: string | null;
  gstin: string | null;
  gst_treatment: string | null;
}

export async function createLedger(payload: LedgerInsertPayload): Promise<LedgerRow> {
  const id = newId();
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();
  
  const localRecord: LedgerCacheRow = {
    ...payload,
    id,
    gst_treatment: (payload.gst_registration_type as string | undefined) ?? "regular",
    updated_at: now,
    is_synced: false,
    is_deleted: false,
  };

  // Write directly to local v2 cache table
  await offlineDb.cache_ledgers.put(localRecord);

  // Mirror into in-memory masters cache so pickers see it immediately.
  upsertCachedLedger({
    id,
    name: payload.name,
    type: String(payload.type),
    state_code: payload.state_code ?? null,
    gstin: payload.gstin ?? null,
    gst_treatment: (payload.gst_registration_type as string | undefined) ?? "regular",
    gst_registration_type: payload.gst_registration_type ?? null,
    msme_registered: payload.msme_registered ?? null,
    msme_udyam_no: payload.msme_udyam_no ?? null,
    msme_classification: payload.msme_classification ?? null,
    credit_days: payload.credit_days ?? null,
    is_active: true,
  } as CachedLedger);

  if (!isLocalOnlyMode()) {
    // Queue write to the durable outbox to allow replay on reconnect.
    await enqueueWrite({
      op: "insert",
      table: "ledgers",
      payload: { ...payload, id, updated_at: now },
      company_id: payload.company_id,
      label: `Ledger: ${payload.name}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    // Non-blocking catch-up execution call
    syncEssentialMasters(payload.company_id);
  }

  return {
    id,
    name: payload.name,
    type: String(payload.type),
    state_code: payload.state_code ?? null,
    gstin: payload.gstin ?? null,
    gst_treatment: (payload.gst_registration_type as string | undefined) ?? "regular",
  };
}

export async function updateLedger(
  id: string,
  companyId: string,
  values: Partial<LedgerInsertPayload>,
): Promise<LedgerRow | null> {
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();
  const existing = await offlineDb.cache_ledgers.get(id);

  if (existing) {
    const nextGstTreatment =
      values.gst_registration_type !== undefined
        ? (values.gst_registration_type as string | null) ?? "regular"
        : existing.gst_treatment;
    const updatedRecord: LedgerCacheRow = {
      ...existing,
      ...values,
      gst_treatment: nextGstTreatment,
      updated_at: now,
      is_synced: false,
    };
    await offlineDb.cache_ledgers.put(updatedRecord);
    upsertCachedLedger({
      id,
      name: (updatedRecord.name ?? existing.name) as string,
      type: String(updatedRecord.type ?? existing.type),
      state_code: (updatedRecord.state_code ?? existing.state_code) ?? null,
      gstin: (updatedRecord.gstin ?? existing.gstin) ?? null,
      gst_treatment: nextGstTreatment ?? "regular",
      gst_registration_type: updatedRecord.gst_registration_type ?? null,
      msme_registered: updatedRecord.msme_registered ?? null,
      msme_udyam_no: updatedRecord.msme_udyam_no ?? null,
      msme_classification: updatedRecord.msme_classification ?? null,
      credit_days: updatedRecord.credit_days ?? null,
      is_active: updatedRecord.is_active !== false,
    } as CachedLedger);
  }

  if (!isLocalOnlyMode()) {
    await enqueueWrite({
      op: "update",
      table: "ledgers",
      payload: { id, values: { ...values, updated_at: now } },
      company_id: companyId,
      label: `Update ledger: ${values.name ?? id.slice(0, 8)}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    syncEssentialMasters(companyId);
  }

  return existing ? (existing as unknown as LedgerRow) : null;
}

export async function deleteLedger(id: string, companyId: string, label?: string): Promise<void> {
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();
  const existing = await offlineDb.cache_ledgers.get(id);

  if (existing) {
    // Soft delete tracking inside local storage
    await offlineDb.cache_ledgers.put({
      ...existing,
      is_deleted: true,
      is_synced: false,
      updated_at: now,
    });
    removeCachedLedger(id);
  }

  if (!isLocalOnlyMode()) {
    await enqueueWrite({
      op: "delete",
      table: "ledgers",
      payload: { id },
      company_id: companyId,
      label: `Delete ledger: ${label ?? id.slice(0, 8)}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    syncEssentialMasters(companyId);
  }
}

export async function deactivateLedger(id: string, companyId: string): Promise<void> {
  await updateLedger(id, companyId, { is_active: false } as any);
}

// ---------- Items -----------------------------------------------------------

export interface ItemInsertPayload {
  company_id: string;
  name: string;
  hsn_code?: string | null;
  unit: string;
  gst_rate: number;
  purchase_price_paise?: number;
  sale_price_paise?: number;
  opening_stock_qty?: number;
  opening_stock_rate_paise?: number;
  reorder_level?: number;
}

export interface ItemRow {
  id: string;
  name: string;
  unit: string;
  gst_rate: number;
  hsn_code: string | null;
}

export async function createItem(payload: ItemInsertPayload): Promise<ItemRow> {
  const id = newId();
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();

  const localRecord: ItemCacheRow = {
    ...payload,
    id,
    updated_at: now,
    is_synced: false,
    is_deleted: false,
  };

  await offlineDb.cache_items.put(localRecord);
  upsertCachedItem({
    id,
    name: payload.name,
    unit: payload.unit,
    gst_rate: payload.gst_rate,
    hsn_code: payload.hsn_code ?? null,
    is_active: true,
  } as CachedItem);

  if (!isLocalOnlyMode()) {
    await enqueueWrite({
      op: "insert",
      table: "items",
      payload: { ...payload, id, updated_at: now },
      company_id: payload.company_id,
      label: `Item: ${payload.name}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    syncEssentialMasters(payload.company_id);
  }

  return {
    id,
    name: payload.name,
    unit: payload.unit,
    gst_rate: payload.gst_rate,
    hsn_code: payload.hsn_code ?? null,
  };
}

export async function updateItem(
  id: string,
  companyId: string,
  values: Partial<ItemInsertPayload>,
): Promise<ItemRow | null> {
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();
  const existing = await offlineDb.cache_items.get(id);

  if (existing) {
    const updatedRecord: ItemCacheRow = {
      ...existing,
      ...values,
      updated_at: now,
      is_synced: false,
    };
    await offlineDb.cache_items.put(updatedRecord);
    upsertCachedItem({
      id,
      name: (updatedRecord.name ?? existing.name) as string,
      unit: (updatedRecord.unit ?? existing.unit) as string,
      gst_rate: (updatedRecord.gst_rate ?? existing.gst_rate) as number,
      hsn_code: (updatedRecord.hsn_code ?? existing.hsn_code) ?? null,
      is_active: updatedRecord.is_active !== false,
    } as CachedItem);
  }

  if (!isLocalOnlyMode()) {
    await enqueueWrite({
      op: "update",
      table: "items",
      payload: { id, values: { ...values, updated_at: now } },
      company_id: companyId,
      label: `Update item: ${values.name ?? id.slice(0, 8)}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    syncEssentialMasters(companyId);
  }

  return existing ? (existing as unknown as ItemRow) : null;
}

export async function deleteItem(id: string, companyId: string, label?: string): Promise<void> {
  const now = new Date().toISOString();
  const offlineDb = await getDbInstance();
  const existing = await offlineDb.cache_items.get(id);

  if (existing) {
    await offlineDb.cache_items.put({
      ...existing,
      is_deleted: true,
      is_synced: false,
      updated_at: now,
    });
  }

  if (!isLocalOnlyMode()) {
    await enqueueWrite({
      op: "delete",
      table: "items",
      payload: { id },
      company_id: companyId,
      label: `Delete item: ${label ?? id.slice(0, 8)}`,
    });
  }

  if (!isLocalOnlyMode() && isOnlineNow()) {
    syncEssentialMasters(companyId);
  }
}

export async function deactivateItem(id: string, companyId: string): Promise<void> {
  await updateItem(id, companyId, { is_active: false } as any);
}
