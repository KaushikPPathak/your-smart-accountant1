// Write outbox: mutations queued while offline.
//
// Phase 1 only exposes the queue primitives + a sync worker. Individual
// call sites (createVoucher, updateLedger, etc.) can opt in by routing
// through `enqueueWrite()` / `runOrQueue()` in later phases.

import { supabase } from "@/integrations/supabase/client";
import { offlineDb, type OutboxRow } from "./db";
import { isOnlineNow, pingOnline } from "./online-status";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export async function queueSize(): Promise<number> {
  return offlineDb.outbox.count();
}

export async function listOutbox(): Promise<OutboxRow[]> {
  return offlineDb.outbox.orderBy("created_at").toArray();
}

export async function enqueueWrite(row: Omit<OutboxRow, "id" | "created_at" | "attempts" | "last_error">): Promise<void> {
  await offlineDb.outbox.add({
    ...row,
    created_at: Date.now(),
    attempts: 0,
    last_error: null,
  });
  emit();
}

/**
 * Run an operation against Supabase if online, otherwise queue it.
 * Returns `{ ok, queued }`. Callers decide what to do with the result.
 */
export async function runOrQueue(
  row: Omit<OutboxRow, "id" | "created_at" | "attempts" | "last_error">,
): Promise<{ queued: boolean }> {
  if (isOnlineNow()) {
    try {
      await executeOutboxRow({ ...row, created_at: Date.now(), attempts: 0, last_error: null });
      return { queued: false };
    } catch {
      await enqueueWrite(row);
      return { queued: true };
    }
  }
  await enqueueWrite(row);
  return { queued: true };
}

async function executeOutboxRow(row: OutboxRow): Promise<void> {
  if (row.op === "rpc" && row.rpc) {
    const { error } = await (supabase as unknown as {
      rpc: (name: string, args: unknown) => Promise<{ error: { message: string } | null }>;
    }).rpc(row.rpc, row.payload);
    if (error) throw new Error(error.message);
    return;
  }
  if (!row.table) throw new Error("Outbox row missing table");
  const q = supabase.from(row.table as never);
  if (row.op === "insert") {
    const { error } = await q.insert(row.payload as never);
    if (error) throw new Error(error.message);
  } else if (row.op === "update") {
    const p = row.payload as { id: string; values: Record<string, unknown> };
    const { error } = await q.update(p.values as never).eq("id", p.id);
    if (error) throw new Error(error.message);
  } else if (row.op === "delete") {
    const p = row.payload as { id: string };
    const { error } = await q.delete().eq("id", p.id);
    if (error) throw new Error(error.message);
  }
}

let draining = false;

export async function drainOutbox(): Promise<{ pushed: number; failed: number }> {
  if (draining) return { pushed: 0, failed: 0 };
  draining = true;
  let pushed = 0;
  let failed = 0;
  try {
    const online = await pingOnline();
    if (!online) return { pushed: 0, failed: 0 };
    const rows = await offlineDb.outbox.orderBy("created_at").toArray();
    for (const row of rows) {
      try {
        await executeOutboxRow(row);
        if (row.id !== undefined) await offlineDb.outbox.delete(row.id);
        pushed += 1;
        emit();
      } catch (e) {
        failed += 1;
        if (row.id !== undefined) {
          await offlineDb.outbox.update(row.id, {
            attempts: (row.attempts ?? 0) + 1,
            last_error: e instanceof Error ? e.message : String(e),
          });
        }
        // Stop after a failure so we don't burn through everything against a
        // server that's down. The user can retry from the status drawer.
        break;
      }
    }
    return { pushed, failed };
  } finally {
    draining = false;
    emit();
  }
}

export async function clearOutboxRow(id: number): Promise<void> {
  await offlineDb.outbox.delete(id);
  emit();
}
