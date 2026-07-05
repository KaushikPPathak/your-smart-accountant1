// Write outbox: mutations queued while offline.
// Includes strict, timestamp-aware delivery matching our Last-Write-Wins pattern.

import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow, pingOnline } from "./online-status";

// Isolated interfaces prevent static AST bundling deadlocks
export interface OutboxRow {
  id?: number;
  company_id?: string | null;
  table: string;
  op: "insert" | "update" | "delete" | "rpc" | "custom";
  payload: any;
  created_at?: number;
  attempts?: number;
  last_error?: string | null;
  label?: string;
  executor?: string;
  rpc?: string;
}

// Runtime dynamic import resolver to completely bypass top-of-file compilation crashes
async function getDbInstance() {
  const module = await import("./db");
  return module.default || module.offlineDb || module.db || (module as any);
}

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
  const db = await getDbInstance();
  return db.outbox.count();
}

export async function listOutbox(): Promise<OutboxRow[]> {
  const db = await getDbInstance();
  return db.outbox.orderBy("created_at").toArray() as unknown as OutboxRow[];
}

export async function enqueueWrite(row: Omit<OutboxRow, "id" | "created_at" | "attempts" | "last_error">): Promise<void> {
  const db = await getDbInstance();
  await db.outbox.add({
    ...row,
    created_at: Date.now(),
    attempts: 0,
    last_error: null,
  });
  emit();
}

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
  if (row.op === "custom" && row.executor) {
    const { getVoucherExecutor } = await import("./voucher-executors");
    const fn = getVoucherExecutor(row.executor);
    if (!fn) throw new Error(`No executor registered for "${row.executor}"`);
    await fn(row.payload);
    return;
  }

  if (row.op === "rpc" && (row as any).rpc) {
    const { error } = await (supabase as unknown as {
      rpc: (name: string, args: unknown) => Promise<{ error: { message: string } | null }>;
    }).rpc((row as any).rpc, row.payload);
    if (error) throw new Error(error.message);
    return;
  }

  if (!row.table) throw new Error("Outbox row missing target table association");
  const q = supabase.from(row.table as never);

  if (row.op === "insert") {
    if (row.table === "ledgers" || row.table === "items") {
      const { error } = await q.upsert(row.payload as never, { onConflict: "id" });
      if (error) {
        const code = (error as { code?: string }).code;
        const message = error.message ?? "Insert failed";
        if (code === "23505" || /duplicate key/i.test(message)) return;
        throw new Error(message);
      }
    } else {
      const { error } = await q.insert(row.payload as never);
      if (error) throw new Error(error.message);
    }
  } 
  
  else if (row.op === "update") {
    const p = row.payload as { id: string; values: Record<string, unknown> };
    
    if (row.table === "ledgers" || row.table === "items") {
      const { error } = await q.upsert({ id: p.id, ...p.values } as never);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await q.update(p.values as never).eq("id", p.id);
      if (error) throw new Error(error.message);
    }
  } 
  
  else if (row.op === "delete") {
    const p = row.payload as { id: string };
    const { error } = await q.delete().eq("id", p.id);
    if (error) throw new Error(error.message);
  }
}

// A row is "poison" when the server rejected it for a reason that will not
// resolve itself on retry: RLS denies, validation/constraint violation,
// invalid input, foreign-key gap, etc. These get moved to `dead_letter`
// immediately instead of blocking the queue.
const POISON_ERROR_RE =
  /permission denied|not authorized|unauthorized|violates|check constraint|foreign key|invalid input|duplicate key|not-null|out of range|column .* does not exist|relation .* does not exist/i;
const MAX_TRANSIENT_ATTEMPTS = 8;

function isPoisonError(message: string): boolean {
  return POISON_ERROR_RE.test(message || "");
}

async function moveToDeadLetter(
  db: any,
  row: OutboxRow,
  message: string,
): Promise<void> {
  const { id: _drop, ...rest } = row;
  await db.dead_letter.add({
    ...rest,
    original_id: row.id ?? null,
    moved_at: Date.now(),
    last_error: message,
    attempts: (row.attempts ?? 0) + 1,
  });
  if (row.id !== undefined) await db.outbox.delete(row.id);
}

export async function drainOutbox(): Promise<{ pushed: number; failed: number; poisoned: number }> {
  if (draining) return { pushed: 0, failed: 0, poisoned: 0 };
  draining = true;
  let pushed = 0;
  let failed = 0;
  let poisoned = 0;

  try {
    const online = await pingOnline();
    if (!online) return { pushed: 0, failed: 0, poisoned: 0 };

    const db = await getDbInstance();
    const rows = await db.outbox.orderBy("created_at").toArray() as unknown as OutboxRow[];

    for (const row of rows) {
      try {
        await executeOutboxRow(row);
        if (row.id !== undefined) await db.outbox.delete(row.id);
        // Stamp local master cache as synced so UI badges reflect reality.
        try {
          if ((row.op === "insert" || row.op === "update") && (row.table === "ledgers" || row.table === "items")) {
            const table = row.table === "ledgers" ? db.cache_ledgers : db.cache_items;
            const id = row.op === "insert"
              ? (row.payload as { id?: string })?.id
              : (row.payload as { id?: string })?.id;
            if (id) {
              const existing = await table.get(id);
              if (existing) await table.put({ ...existing, is_synced: true });
            }
          }
        } catch { /* cosmetic; ignore */ }
        pushed += 1;
        emit();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const nextAttempts = (row.attempts ?? 0) + 1;
        if (isPoisonError(message) || nextAttempts >= MAX_TRANSIENT_ATTEMPTS) {
          // Move out of the hot queue so it stops blocking siblings and can
          // be inspected / retried / discarded from the Data Sync screen.
          await moveToDeadLetter(db, row, message);
          poisoned += 1;
        } else {
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
  } finally {
    draining = false;
    emit();
  }
}

export async function clearOutboxRow(id: number): Promise<void> {
  const db = await getDbInstance();
  await db.outbox.delete(id);
  emit();
}

// --- Dead-letter (needs-attention) queue ---------------------------------

export interface DeadLetterRow extends OutboxRow {
  moved_at: number;
  original_id: number | null;
}

export async function listDeadLetter(): Promise<DeadLetterRow[]> {
  const db = await getDbInstance();
  return db.dead_letter.orderBy("moved_at").toArray() as unknown as DeadLetterRow[];
}

export async function deadLetterCount(): Promise<number> {
  const db = await getDbInstance();
  return db.dead_letter.count();
}

export async function retryDeadLetter(id: number): Promise<void> {
  const db = await getDbInstance();
  const row = await db.dead_letter.get(id) as DeadLetterRow | undefined;
  if (!row) return;
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

export async function discardDeadLetter(id: number): Promise<void> {
  const db = await getDbInstance();
  await db.dead_letter.delete(id);
  emit();
}

