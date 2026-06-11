// Offline-aware writes for master tables (ledgers, items) with true bi-directional sync.
//
// Every operation updates the local offlineDb first to guarantee total availability,
// stamps it with 'updated_at', and flags it with 'is_synced: false'. If a connection is 
// available, a synchronization pass runs automatically to match data based on the latest timestamp.

import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow } from "./online-status";
import { offlineDb } from "./db";

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Robust Bi-Directional Master Synchronizer
 * Evaluates Local vs Remote state using Last-Write-Wins (LWW) timestamp logic.
 */
export async function syncEssentialMasters(companyId: string): Promise<void> {
  if (!isOnlineNow() || !companyId) return;

  try {
    // ------------------- Sync Items -------------------
    const localItems = await offlineDb.table("items").where("company_id").eq(companyId).toArray();
    const { data: remoteItems, error: itemsError } = await supabase
      .from("items")
      .select("*")
      .eq("company_id", companyId);

    if (itemsError) throw itemsError;

    // Process items from cloud down to local storage
    for (const remote of (remoteItems || [])) {
      const local = localItems.find((i) => i.id === remote.id);
      if (!local) {
        // New record created on the cloud, download it
        await offlineDb.table("items").put({ ...remote, is_synced: true, is_deleted: false });
      } else {
        const localTime = new Date(local.updated_at || 0).getTime();
        const remoteTime = new Date(remote.updated_at || 0).getTime();

        if (remoteTime > localTime) {
          // Cloud has newer data, overwrite local copy
          await offlineDb.table("items").put({ ...remote, is_synced: true, is_deleted: false });
        }
      }
    }

    // Push local edits upstream to the cloud
    const unsyncedItems = await offlineDb.table("items")
      .where("company_id").eq(companyId)
      .and(item => !item.is_synced)
      .toArray();

    for (const item of unsyncedItems) {
      if (item.is_deleted) {
        await supabase.from("items").delete().eq("id", item.id);
        await offlineDb.table("items").delete(item.id); // Permanently drop local tracking
      } else {
        const { is_synced, is_deleted, ...payload } = item;
        await supabase.from("items").upsert(payload);
        await offlineDb.table("items").update(item.id, { is_synced: true });
      }
    }

    // ------------------- Sync Ledgers -------------------
    const localLedgers = await offlineDb.table("ledgers").where("company_id").eq(companyId).toArray();
    const { data: remoteLedgers, error: ledgersError } = await supabase
      .from("ledgers")
      .select("*")
      .eq("company_id", companyId);

    if (ledgersError) throw ledgersError;

    for (const remote of (remoteLedgers || [])) {
      const local = localLedgers.find((l) => l.id === remote.id);
      if (!local) {
        await offlineDb.table("ledgers").put({ ...remote, is_synced: true, is_deleted: false });
      } else {
        const localTime = new Date(local.updated_at || 0).getTime();
        const remoteTime = new Date(remote.updated_at || 0).getTime();

        if (remoteTime > localTime) {
          await offlineDb.table("ledgers").put({ ...remote, is_synced: true, is_deleted: false });
        }
      }
    }

    const unsyncedLedgers = await offlineDb.table("ledgers")
      .where("company_id").eq(companyId)
      .and(ledger => !ledger.is_synced)
      .toArray();

    for (const ledger of unsyncedLedgers) {
      if (ledger.is_deleted) {
        await supabase.from("ledgers").delete().eq("id", ledger.id);
        await offlineDb.table("ledgers").delete(ledger.id);
      } else {
        const { is_synced, is_deleted, ...payload } = ledger;
        await supabase.from("ledgers").upsert(payload);
        await offlineDb.table("ledgers").update(ledger.id, { is_synced: true });
      }
    }

  } catch (err) {
    console.error("Master table synchronization deferred: ", err);
  }
}

// ---------- Ledgers ---------------------------------------------------------

export interface LedgerInsertPayload {
  company_id: string;
  name: string;
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
  
  const localRecord = {
    ...payload,
    id,
    gst_treatment: "regular",
    created_at: now,
    updated_at: now,
    is_synced: false,
    is_deleted: false,
  };

  // Local-First Write
  await offlineDb.table("ledgers").put(localRecord);

  // Background Trigger execution
  if (isOnlineNow()) {
    syncEssentialMasters(payload.company_id);
  }

  return {
    id,
    name: payload.name,
    type: String(payload.type),
    state_code: payload.state_code ?? null,
    gstin: payload.gstin ?? null,
    gst_treatment: "regular",
  };
}

export async function updateLedger(
  id: string,
  companyId: string,
  values: Partial<LedgerInsertPayload>,
): Promise<LedgerRow | null> {
  const now = new Date().toISOString();
  const existing = await offlineDb.table("ledgers").get(id);

  if (existing) {
    const updatedRecord = {
      ...existing,
      ...values,
      updated_at: now,
      is_synced: false,
    };
    await offlineDb.table("ledgers").put(updatedRecord);
  }

  if (isOnlineNow()) {
    syncEssentialMasters(companyId);
  }

  return existing ? (existing as LedgerRow) : null;
}

export async function deleteLedger(id: string, companyId: string, label?: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await offlineDb.table("ledgers").get(id);

  if (existing) {
    // Flag as soft delete locally so sync architecture can inform cloud database
    await offlineDb.table("ledgers").put({
      ...existing,
      is_deleted: true,
      is_synced: false,
      updated_at: now,
    });
  }

  if (isOnlineNow()) {
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

  const localRecord = {
    ...payload,
    id,
    created_at: now,
    updated_at: now,
    is_synced: false,
    is_deleted: false,
  };

  await offlineDb.table("items").put(localRecord);

  if (isOnlineNow()) {
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
  const existing = await offlineDb.table("items").get(id);

  if (existing) {
    const updatedRecord = {
      ...existing,
      ...values,
      updated_at: now,
      is_synced: false,
    };
    await offlineDb.table("items").put(updatedRecord);
  }

  if (isOnlineNow()) {
    syncEssentialMasters(companyId);
  }

  return existing ? (existing as ItemRow) : null;
}

export async function deleteItem(id: string, companyId: string, label?: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await offlineDb.table("items").get(id);

  if (existing) {
    await offlineDb.table("items").put({
      ...existing,
      is_deleted: true,
      is_synced: false,
      updated_at: now,
    });
  }

  if (isOnlineNow()) {
    syncEssentialMasters(companyId);
  }
}

export async function deactivateItem(id: string, companyId: string): Promise<void> {
  await updateItem(id, companyId, { is_active: false } as any);
}
