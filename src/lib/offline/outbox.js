// Write outbox: mutations queued while offline.
// Includes strict, timestamp-aware delivery matching our Last-Write-Wins pattern.
import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow, pingOnline } from "./online-status";
// Runtime dynamic import resolver to completely bypass top-of-file compilation crashes
async function getDbInstance() {
    const module = await import("./db");
    return module.default || module.offlineDb || module.db || module;
}
const listeners = new Set();
export function subscribeOutbox(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
function emit() {
    for (const fn of listeners) {
        try {
            fn();
        }
        catch { /* ignore */ }
    }
}
export async function queueSize() {
    const db = await getDbInstance();
    return db.outbox.count();
}
export async function listOutbox() {
    const db = await getDbInstance();
    return db.outbox.orderBy("created_at").toArray();
}
export async function enqueueWrite(row) {
    const db = await getDbInstance();
    await db.outbox.add({
        ...row,
        created_at: Date.now(),
        attempts: 0,
        last_error: null,
    });
    emit();
}
export async function runOrQueue(row) {
    if (isOnlineNow()) {
        try {
            await executeOutboxRow({ ...row, created_at: Date.now(), attempts: 0, last_error: null });
            return { queued: false };
        }
        catch {
            await enqueueWrite(row);
            return { queued: true };
        }
    }
    await enqueueWrite(row);
    return { queued: true };
}
async function executeOutboxRow(row) {
    if (row.op === "custom" && row.executor) {
        const { getVoucherExecutor } = await import("./voucher-executors");
        const fn = getVoucherExecutor(row.executor);
        if (!fn)
            throw new Error(`No executor registered for "${row.executor}"`);
        await fn(row.payload);
        return;
    }
    if (row.op === "rpc" && row.rpc) {
        const { error } = await supabase.rpc(row.rpc, row.payload);
        if (error)
            throw new Error(error.message);
        return;
    }
    if (!row.table)
        throw new Error("Outbox row missing target table association");
    const q = supabase.from(row.table);
    if (row.op === "insert") {
        if (row.table === "ledgers" || row.table === "items") {
            const { error } = await q.upsert(row.payload, { onConflict: "id" });
            if (error) {
                const code = error.code;
                const message = error.message ?? "Insert failed";
                if (code === "23505" || /duplicate key/i.test(message))
                    return;
                throw new Error(message);
            }
        }
        else {
            const { error } = await q.insert(row.payload);
            if (error)
                throw new Error(error.message);
        }
    }
    else if (row.op === "update") {
        const p = row.payload;
        if (row.table === "ledgers" || row.table === "items") {
            const { error } = await q.upsert({ id: p.id, ...p.values });
            if (error)
                throw new Error(error.message);
        }
        else {
            const { error } = await q.update(p.values).eq("id", p.id);
            if (error)
                throw new Error(error.message);
        }
    }
    else if (row.op === "delete") {
        const p = row.payload;
        // Soft-delete tables: leave a tombstone (deleted_at = now) so other
        // devices learn about the delete on their next delta sync. The local
        // cache is pruned by the caller as it was for hard deletes.
        if (SOFT_DELETE_TABLES.has(row.table)) {
            const { error } = await q
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", p.id);
            if (error)
                throw new Error(error.message);
        }
        else {
            const { error } = await q.delete().eq("id", p.id);
            if (error)
                throw new Error(error.message);
        }
    }
}
// Tables where `deleted_at` was added by the soft-delete migration. Delete
// ops targeting these tables become tombstone UPDATEs on the server so the
// delete propagates to other devices via the delta pull.
const SOFT_DELETE_TABLES = new Set([
    "ledgers",
    "items",
    "vouchers",
    "account_subgroups",
    "ledger_group_mappings",
    "account_group_overrides",
]);
let draining = false;
// A row is "poison" when the server rejected it for a reason that will not
// resolve itself on retry: RLS denies, validation/constraint violation,
// invalid input, foreign-key gap, etc. These get moved to `dead_letter`
// immediately instead of blocking the queue.
const POISON_ERROR_RE = /permission denied|not authorized|unauthorized|violates|check constraint|foreign key|invalid input|duplicate key|not-null|out of range|column .* does not exist|relation .* does not exist/i;
const MAX_TRANSIENT_ATTEMPTS = 8;
function isPoisonError(message) {
    return POISON_ERROR_RE.test(message || "");
}
async function moveToDeadLetter(db, row, message) {
    const { id: _drop, ...rest } = row;
    await db.dead_letter.add({
        ...rest,
        original_id: row.id ?? null,
        moved_at: Date.now(),
        last_error: message,
        attempts: (row.attempts ?? 0) + 1,
    });
    if (row.id !== undefined)
        await db.outbox.delete(row.id);
}
export async function drainOutbox() {
    // Local-only mode: never push business data to our servers. When enabled
    // (the default), the outbox stays purely local — the user's data never
    // leaves the device except via a user-controlled backup they configure.
    const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
    if (isLocalOnlyMode())
        return { pushed: 0, failed: 0, poisoned: 0 };
    if (draining)
        return { pushed: 0, failed: 0, poisoned: 0 };
    draining = true;
    let pushed = 0;
    let failed = 0;
    let poisoned = 0;
    try {
        const online = await pingOnline();
        if (!online)
            return { pushed: 0, failed: 0, poisoned: 0 };
        const db = await getDbInstance();
        const rows = await db.outbox.orderBy("created_at").toArray();
        for (const row of rows) {
            try {
                await executeOutboxRow(row);
                if (row.id !== undefined)
                    await db.outbox.delete(row.id);
                // Stamp local master cache as synced so UI badges reflect reality.
                try {
                    if ((row.op === "insert" || row.op === "update") && (row.table === "ledgers" || row.table === "items")) {
                        const table = row.table === "ledgers" ? db.cache_ledgers : db.cache_items;
                        const id = row.op === "insert"
                            ? row.payload?.id
                            : row.payload?.id;
                        if (id) {
                            const existing = await table.get(id);
                            if (existing)
                                await table.put({ ...existing, is_synced: true });
                        }
                    }
                }
                catch { /* cosmetic; ignore */ }
                pushed += 1;
                emit();
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                const nextAttempts = (row.attempts ?? 0) + 1;
                if (isPoisonError(message) || nextAttempts >= MAX_TRANSIENT_ATTEMPTS) {
                    // Move out of the hot queue so it stops blocking siblings and can
                    // be inspected / retried / discarded from the Data Sync screen.
                    await moveToDeadLetter(db, row, message);
                    poisoned += 1;
                }
                else {
                    failed += 1;
                    if (row.id !== undefined) {
                        await db.outbox.update(row.id, {
                            attempts: nextAttempts,
                            last_error: message,
                        });
                    }
                }
                // Keep going — one bad row must not block every other pending change.
                continue;
            }
        }
        if (rows.length > 0 && rows[0].company_id) {
            const { syncEssentialMasters } = await import("./masters");
            await syncEssentialMasters(rows[0].company_id);
        }
        return { pushed, failed, poisoned };
    }
    finally {
        draining = false;
        emit();
    }
}
export async function materializeLocalOnlyOutbox() {
    const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
    if (!isLocalOnlyMode())
        return { applied: 0, failed: 0 };
    const db = await getDbInstance();
    const rows = await db.outbox.orderBy("created_at").toArray();
    let applied = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            if (row.op === "custom" && row.executor) {
                await executeOutboxRow(row);
                if (row.id !== undefined)
                    await db.outbox.delete(row.id);
                applied += 1;
                emit();
            }
        }
        catch (e) {
            failed += 1;
            if (row.id !== undefined) {
                await db.outbox.update(row.id, {
                    attempts: (row.attempts ?? 0) + 1,
                    last_error: e instanceof Error ? e.message : String(e),
                });
            }
        }
    }
    return { applied, failed };
}
export async function clearOutboxRow(id) {
    const db = await getDbInstance();
    await db.outbox.delete(id);
    emit();
}
export async function listDeadLetter() {
    const db = await getDbInstance();
    return db.dead_letter.orderBy("moved_at").toArray();
}
export async function deadLetterCount() {
    const db = await getDbInstance();
    return db.dead_letter.count();
}
export async function retryDeadLetter(id) {
    const db = await getDbInstance();
    const row = await db.dead_letter.get(id);
    if (!row)
        return;
    const { id: _dropId, moved_at: _m, original_id: _o, ...rest } = row;
    await db.outbox.add({
        ...rest,
        attempts: 0,
        last_error: null,
        created_at: Date.now(),
    });
    await db.dead_letter.delete(id);
    emit();
}
export async function discardDeadLetter(id) {
    const db = await getDbInstance();
    await db.dead_letter.delete(id);
    emit();
}
