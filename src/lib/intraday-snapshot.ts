// Intraday snapshots — hourly, in-app, IndexedDB-only.
//
// Round 2 supplement to the daily on-disk snapshot. Between two daily
// snapshots a user can enter dozens of vouchers; a crash, an accidental
// delete, or a bad restore between 08:00 and 22:00 would revert them all.
// This module keeps a tiny ring buffer of the last N full-company payloads
// (default 6) in the same IndexedDB `meta` store the auto-restore net uses,
// so it works in every runtime (web, Tauri, Electron) with zero disk I/O.
//
// It is NEVER used for silent recovery — the user opens Housekeeping →
// "Restore from intraday snapshot" and picks a point in time. This gives
// them a same-day undo that the daily on-disk lineage cannot provide.
//
// Storage key: `intraday_snapshots:<companyId>`  ->  RingBufferRow[]
// Each row stores a full v2 CompanyBackup. Payloads are already small
// (JSON, no images), so 6 slots per company remain well under the IDB
// quota even for large books.

import { getMeta, setMeta, offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";

export const INTRADAY_RING_SIZE = 6;
/** Take a fresh snapshot at most once per this many ms (prevents thrash). */
export const INTRADAY_MIN_INTERVAL_MS = 55 * 60 * 1000; // ~1h with drift room
/** Timer cadence — checks each company every hour. */
const SCHEDULE_TICK_MS = 60 * 60 * 1000;

interface RingBufferRow {
  createdAt: number;
  reason: "hourly" | "manual" | "pre-bulk-change";
  ledgers: number;
  items: number;
  vouchers: number;
  payload: CompanyBackup;
}

function key(companyId: string): string {
  return `intraday_snapshots:${companyId}`;
}

async function readRing(companyId: string): Promise<RingBufferRow[]> {
  const rows = await getMeta<RingBufferRow[]>(key(companyId));
  return Array.isArray(rows) ? rows : [];
}

async function writeRing(companyId: string, rows: RingBufferRow[]): Promise<void> {
  await setMeta(key(companyId), rows);
}

/**
 * Capture a snapshot into the ring buffer. No-op if the last snapshot is
 * younger than `INTRADAY_MIN_INTERVAL_MS` and `reason === "hourly"`. Manual
 * / pre-bulk-change calls always record so the user can force a checkpoint
 * before a risky action (import, bulk delete, restore).
 */
export async function saveIntradaySnapshot(
  companyId: string,
  reason: RingBufferRow["reason"] = "hourly",
): Promise<{ saved: boolean; reason?: string }> {
  try {
    const ring = await readRing(companyId);
    if (reason === "hourly" && ring.length > 0) {
      const last = ring[ring.length - 1];
      if (Date.now() - last.createdAt < INTRADAY_MIN_INTERVAL_MS) {
        return { saved: false, reason: "too-soon" };
      }
    }
    const payload = await buildCompanyBackup(companyId);
    // Skip if empty AND we already have at least one healthier snapshot —
    // never overwrite a good history with an empty one (same rule the
    // daily writer follows).
    const total = (payload.ledgers?.length ?? 0)
      + (payload.items?.length ?? 0)
      + (payload.vouchers?.length ?? 0);
    if (total === 0 && ring.some((r) => (r.ledgers + r.items + r.vouchers) > 0)) {
      return { saved: false, reason: "empty-would-overwrite" };
    }
    const row: RingBufferRow = {
      createdAt: Date.now(),
      reason,
      ledgers: payload.ledgers?.length ?? 0,
      items: payload.items?.length ?? 0,
      vouchers: payload.vouchers?.length ?? 0,
      payload,
    };
    const next = [...ring, row].slice(-INTRADAY_RING_SIZE);
    await writeRing(companyId, next);
    return { saved: true };
  } catch (e) {
    return { saved: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface IntradaySnapshotSummary {
  createdAt: number;
  reason: RingBufferRow["reason"];
  ledgers: number;
  items: number;
  vouchers: number;
}

export async function listIntradaySnapshots(
  companyId: string,
): Promise<IntradaySnapshotSummary[]> {
  const ring = await readRing(companyId);
  return ring
    .map(({ payload: _p, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restore the company from the intraday snapshot with the given createdAt.
 * The current state is captured into the pre-restore safety net first so
 * the user still gets 24h undo on this action too.
 */
export async function restoreIntradaySnapshot(
  companyId: string,
  createdAt: number,
): Promise<void> {
  const ring = await readRing(companyId);
  const row = ring.find((r) => r.createdAt === createdAt);
  if (!row) throw new Error("Intraday snapshot not found (may have rolled off the ring)");
  const { savePreRestoreSnapshot } = await import("@/lib/restore-safety");
  // Best-effort — if the safety snapshot fails we still allow the restore
  // because the user explicitly picked this recovery point.
  await savePreRestoreSnapshot(companyId, String(row.payload.company?.name ?? "Company"));
  await restoreCompanyBackup(companyId, row.payload);
}

export async function clearIntradayRing(companyId: string): Promise<void> {
  try { await offlineDb.meta.delete(key(companyId)); } catch { /* ignore */ }
}

let scheduleHandle: number | null = null;

/**
 * Start the hourly capture loop for every listed company. Idempotent —
 * calling it again replaces the previous timer. Safe to call from the
 * app-shell boot effect. Never throws.
 */
export function scheduleIntradaySnapshots(
  companies: { id: string }[],
): () => void {
  if (typeof window === "undefined") return () => {};
  if (scheduleHandle !== null) {
    window.clearInterval(scheduleHandle);
    scheduleHandle = null;
  }
  const tick = async () => {
    for (const c of companies) {
      try { await saveIntradaySnapshot(c.id, "hourly"); } catch { /* ignore */ }
    }
  };
  // Kick a first pass ~30s after boot so the launch storm calms down first.
  const kickoff = window.setTimeout(() => { void tick(); }, 30_000);
  scheduleHandle = window.setInterval(() => { void tick(); }, SCHEDULE_TICK_MS);
  return () => {
    window.clearTimeout(kickoff);
    if (scheduleHandle !== null) {
      window.clearInterval(scheduleHandle);
      scheduleHandle = null;
    }
  };
}
