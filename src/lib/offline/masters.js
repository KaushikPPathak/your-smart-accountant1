// Offline-aware writes for master tables (ledgers, items) with true bi-directional sync.
//
// Every operation updates the local cache tables first to guarantee total availability,
// stamps it with 'updated_at', and queues the mutation in the outbox. The synchronizer
// pulls down cloud updates incrementally using cursor high-water marks.
import { supabase } from "@/integrations/supabase/client";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { isOnlineNow } from "./online-status";
import { enqueueWrite } from "./outbox";
import { upsertCachedLedger, upsertCachedItem, removeCachedLedger, removeCachedItem, } from "@/lib/masters-cache";
import { emitDataChange } from "@/lib/ai/cache-events";
import { logActivity } from "@/lib/activity-log";
function newId() {
    return crypto.randomUUID();
}
// Runtime dynamic import resolver to prevent Rollup compilation deadlocks
async function getDbInstance() {
    const module = await import("./db");
    return module.default || module.offlineDb || module.db;
}
/**
 * Robust Bi-Directional Master Synchronizer
 * Evaluates Local vs Remote state using Last-Write-Wins (LWW) timestamp logic.
 */
export async function syncEssentialMasters(companyId) {
    if (isLocalOnlyMode())
        return;
    if (!isOnlineNow() || !companyId)
        return;
    const tablesToSync = ["ledgers", "items"];
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
            if (error)
                throw error;
            if (cloudDeltas && cloudDeltas.length > 0) {
                let maxUpdatedAt = lastUpdatedAt;
                for (const remote of cloudDeltas) {
                    const local = await dexieTable.get(remote.id);
                    if (!local) {
                        // Unseen entry: Cache immediately
                        await dexieTable.put({ ...remote, is_synced: true, is_deleted: false });
                    }
                    else {
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
        }
        catch (err) {
            console.error(`Master table synchronization deferred for ${table}: `, err);
        }
    }
}
export async function createLedger(payload) {
    const id = newId();
    const now = new Date().toISOString();
    const offlineDb = await getDbInstance();
    const localRecord = {
        ...payload,
        id,
        gst_treatment: payload.gst_registration_type ?? "regular",
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
        gst_treatment: payload.gst_registration_type ?? "regular",
        gst_registration_type: payload.gst_registration_type ?? null,
        msme_registered: payload.msme_registered ?? null,
        msme_udyam_no: payload.msme_udyam_no ?? null,
        msme_classification: payload.msme_classification ?? null,
        credit_days: payload.credit_days ?? null,
        is_active: true,
    });
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
    emitDataChange(payload.company_id, "ledger", [`ledger:${payload.name.toLowerCase()}`]);
    void logActivity({ company_id: payload.company_id, entity_type: "ledger", entity_id: id, entity_label: payload.name, action: "create" });
    return {
        id,
        name: payload.name,
        type: String(payload.type),
        state_code: payload.state_code ?? null,
        gstin: payload.gstin ?? null,
        gst_treatment: payload.gst_registration_type ?? "regular",
    };
}
export async function updateLedger(id, companyId, values) {
    const now = new Date().toISOString();
    const offlineDb = await getDbInstance();
    const existing = await offlineDb.cache_ledgers.get(id);
    if (existing) {
        const nextGstTreatment = values.gst_registration_type !== undefined
            ? values.gst_registration_type ?? "regular"
            : existing.gst_treatment;
        const updatedRecord = {
            ...existing,
            ...values,
            gst_treatment: nextGstTreatment,
            updated_at: now,
            is_synced: false,
        };
        await offlineDb.cache_ledgers.put(updatedRecord);
        upsertCachedLedger({
            id,
            name: (updatedRecord.name ?? existing.name),
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
        });
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
    emitDataChange(companyId, "ledger", existing ? [`ledger:${String(existing.name).toLowerCase()}`] : undefined);
    void logActivity({ company_id: companyId, entity_type: "ledger", entity_id: id, entity_label: values.name ?? existing?.name ?? null, action: "update", diff: values });
    return existing ? existing : null;
}
export async function deleteLedger(id, companyId, label) {
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
    emitDataChange(companyId, "ledger", label ? [`ledger:${label.toLowerCase()}`] : undefined);
    void logActivity({ company_id: companyId, entity_type: "ledger", entity_id: id, entity_label: label ?? null, action: "delete" });
}
export async function deactivateLedger(id, companyId) {
    await updateLedger(id, companyId, { is_active: false });
}
export async function createItem(payload) {
    const id = newId();
    const now = new Date().toISOString();
    const offlineDb = await getDbInstance();
    const localRecord = {
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
    });
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
    emitDataChange(payload.company_id, "item", [`item:${payload.name.toLowerCase()}`]);
    void logActivity({ company_id: payload.company_id, entity_type: "item", entity_id: id, entity_label: payload.name, action: "create" });
    return {
        id,
        name: payload.name,
        unit: payload.unit,
        gst_rate: payload.gst_rate,
        hsn_code: payload.hsn_code ?? null,
    };
}
export async function updateItem(id, companyId, values) {
    const now = new Date().toISOString();
    const offlineDb = await getDbInstance();
    const existing = await offlineDb.cache_items.get(id);
    if (existing) {
        const updatedRecord = {
            ...existing,
            ...values,
            updated_at: now,
            is_synced: false,
        };
        await offlineDb.cache_items.put(updatedRecord);
        upsertCachedItem({
            id,
            name: (updatedRecord.name ?? existing.name),
            unit: (updatedRecord.unit ?? existing.unit),
            gst_rate: (updatedRecord.gst_rate ?? existing.gst_rate),
            hsn_code: (updatedRecord.hsn_code ?? existing.hsn_code) ?? null,
            is_active: updatedRecord.is_active !== false,
        });
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
    emitDataChange(companyId, "item", existing ? [`item:${String(existing.name).toLowerCase()}`] : undefined);
    void logActivity({ company_id: companyId, entity_type: "item", entity_id: id, entity_label: values.name ?? existing?.name ?? null, action: "update", diff: values });
    return existing ? existing : null;
}
export async function deleteItem(id, companyId, label) {
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
        removeCachedItem(id);
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
    emitDataChange(companyId, "item", label ? [`item:${label.toLowerCase()}`] : undefined);
    void logActivity({ company_id: companyId, entity_type: "item", entity_id: id, entity_label: label ?? null, action: "delete" });
}
export async function deactivateItem(id, companyId) {
    await updateItem(id, companyId, { is_active: false });
}
