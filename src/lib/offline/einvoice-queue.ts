// Deferred e-invoice / e-way bill generation queue.
//
// IRN and E-Way Bill numbers can only be minted by hitting the IRP / EWB
// portal via a GSP (Setu in this build). That call requires:
//   1. the device to be online, and
//   2. the GSP endpoint to be reachable and healthy.
//
// If either is unavailable, we don't want to block the user — invoices are
// still saved locally via the outbox and stock still moves. We simply queue
// the "please mint an IRN/EWB for this voucher" request here and let the
// background sync worker retry when connectivity returns.
//
// This queue is intentionally separate from the generic write outbox because:
//   * The payload is a fully-formed IRP / EWB JSON, not a Supabase mutation.
//   * On success we upsert into einvoice_details (which flows through the
//     regular outbox), so we don't want double-bookkeeping.
//   * Users need a dedicated "pending IRN" list on the E-Invoice screen so
//     they can see what's still owed to the portal.

import { offlineDb } from "./db";
import { generateIrn, generateEwb } from "@/utils/setu.functions";
import { upsertEinvoice } from "@/lib/einvoice";

export type EinvoiceQueueKind = "irn" | "ewb";
export type EinvoiceQueueStatus = "pending" | "failed";

export interface EinvoiceQueueRow {
  id?: number;
  kind: EinvoiceQueueKind;
  voucher_id: string;
  company_id: string;
  voucher_number?: string;
  payload: Record<string, unknown>;
  status: EinvoiceQueueStatus;
  attempts: number;
  last_error?: string | null;
  created_at: number;
  updated_at: number;
}

const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } }
export function subscribeEinvoiceQueue(fn: () => void): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}

export async function enqueueEinvoice(
  args: {
    kind: EinvoiceQueueKind;
    voucherId: string;
    companyId: string;
    voucherNumber?: string;
    payload: Record<string, unknown>;
  },
): Promise<number> {
  const now = Date.now();
  const row: EinvoiceQueueRow = {
    kind: args.kind,
    voucher_id: args.voucherId,
    company_id: args.companyId,
    voucher_number: args.voucherNumber,
    payload: args.payload,
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  const id = (await offlineDb.einvoice_queue.add(row)) as number;
  notify();
  return id;
}

export async function listEinvoiceQueue(companyId?: string): Promise<EinvoiceQueueRow[]> {
  const rows = (await offlineDb.einvoice_queue.toArray()) as EinvoiceQueueRow[];
  const filtered = companyId ? rows.filter((r) => r.company_id === companyId) : rows;
  return filtered.sort((a, b) => a.created_at - b.created_at);
}

export async function einvoiceQueueSize(companyId?: string): Promise<number> {
  return (await listEinvoiceQueue(companyId)).length;
}

export async function discardEinvoiceQueue(id: number): Promise<void> {
  await offlineDb.einvoice_queue.delete(id);
  notify();
}

/** Mark a row as pending again so drainEinvoiceQueue picks it up. */
export async function retryEinvoiceQueue(id: number): Promise<void> {
  const row = (await offlineDb.einvoice_queue.get(id)) as EinvoiceQueueRow | undefined;
  if (!row) return;
  await offlineDb.einvoice_queue.put({ ...row, status: "pending", last_error: null, updated_at: Date.now() });
  notify();
}

/**
 * A network / offline / transient failure we should retry later, vs. a
 * permanent portal rejection (bad GSTIN, duplicate IRN, invalid HSN) which
 * needs the user to look at it. We keep the row either way but bump attempts
 * so the UI can surface "failed" ones separately.
 */
function isTransient(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|network|timeout|econn|fetch failed|unavailable|503|502|504/i.test(msg);
}

/**
 * Try to drain queued IRN / EWB requests. Called by the sync worker whenever
 * connectivity returns. Best-effort — a permanent portal rejection leaves the
 * row in place with status="failed" so the user can review it.
 */
export async function drainEinvoiceQueue(): Promise<{ ok: number; failed: number; kept: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: 0, failed: 0, kept: await einvoiceQueueSize() };
  }
  const rows = (await offlineDb.einvoice_queue.toArray()) as EinvoiceQueueRow[];
  let ok = 0, failed = 0;
  for (const row of rows) {
    if (row.status !== "pending") continue;
    try {
      if (row.kind === "irn") {
        const res = await generateIrn({ data: { voucherId: row.voucher_id, companyId: row.company_id, payload: row.payload } });
        if (res.success) {
          await upsertEinvoice({
            voucherId: row.voucher_id,
            companyId: row.company_id,
            irn: res.irn,
            ackNo: res.ackNo,
            status: "generated",
          });
          await offlineDb.einvoice_queue.delete(row.id!);
          ok++;
        } else {
          throw new Error(res.error ?? "IRN generation failed");
        }
      } else {
        const res = await generateEwb({ data: { voucherId: row.voucher_id, companyId: row.company_id, payload: row.payload } });
        if (res.success) {
          await upsertEinvoice({
            voucherId: row.voucher_id,
            companyId: row.company_id,
            ewbNo: res.ewbNo,
            ewbValidUntil: res.ewbValidUntil,
          });
          await offlineDb.einvoice_queue.delete(row.id!);
          ok++;
        } else {
          throw new Error(res.error ?? "E-Way Bill generation failed");
        }
      }
    } catch (err) {
      const transient = isTransient(err);
      await offlineDb.einvoice_queue.put({
        ...row,
        attempts: (row.attempts ?? 0) + 1,
        status: transient ? "pending" : "failed",
        last_error: err instanceof Error ? err.message : String(err),
        updated_at: Date.now(),
      });
      if (!transient) failed++;
    }
  }
  notify();
  const kept = (await offlineDb.einvoice_queue.toArray()).length;
  return { ok, failed, kept };
}

/** True when we shouldn't even try a live call — offline. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}
