// Restore safety net — Tally-style ".900" pre-restore snapshot.
//
// Industry rule #5 supplemental: before wiping a company for restore, take a
// silent full-company snapshot into local IndexedDB so the user can undo the
// restore within 24 hours if the wrong file was picked.
//
// The snapshot is stored under `meta` key `restore_snapshot:<companyId>` and
// evicted automatically after `SNAPSHOT_TTL_MS`.

import { buildCompanyBackup, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
import { getMeta, setMeta, offlineDb } from "@/lib/offline/db";

export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface StoredSnapshot {
  companyId: string;
  companyName: string;
  createdAt: number;
  payload: CompanyBackup;
}

function key(companyId: string): string {
  return `restore_snapshot:${companyId}`;
}

/**
 * Build and store a full snapshot of the target company BEFORE a destructive
 * restore. Returns `{ ok, error }`. Callers MUST decide what to do when
 * `ok === false`: either abort the restore, or ask the user to confirm
 * proceeding without an undo net (recommended). See
 * `assertPreRestoreSnapshotOrConfirm` for the standard prompt.
 */
export async function savePreRestoreSnapshot(
  companyId: string,
  companyName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = await buildCompanyBackup(companyId);
    const row: StoredSnapshot = {
      companyId,
      companyName,
      createdAt: Date.now(),
      payload,
    };
    await setMeta(key(companyId), row);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Standard "safety snapshot failed" gate. Returns true if the caller may
 * proceed with the destructive restore, false if the user aborted.
 *
 * When the snapshot was created successfully -> proceeds silently.
 * When the snapshot failed -> shows a blocking confirm() so the user knows
 * the 24-hour Undo Restore option will NOT be available and can bail out.
 * This is the primary way we honour "financial data retrieval is a risky
 * affair" — never wipe live data without an escape hatch unless the user
 * has explicitly acknowledged the risk.
 */
export async function assertPreRestoreSnapshotOrConfirm(
  companyId: string,
  companyName: string,
): Promise<boolean> {
  const snap = await savePreRestoreSnapshot(companyId, companyName);
  if (snap.ok) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    // Non-interactive context (server / test) — fail closed.
    return false;
  }
  return window.confirm(
    `Could not create the safety snapshot for "${companyName}".\n\n` +
    `Reason: ${snap.error ?? "unknown"}\n\n` +
    `If you continue, the 24-hour "Undo restore" option will NOT be available. ` +
    `Free some disk space and retry, or click OK to proceed anyway.`,
  );
}

export interface AvailableSnapshot {
  companyId: string;
  companyName: string;
  createdAt: number;
  ageMs: number;
  expiresInMs: number;
}

/**
 * Return the pre-restore snapshot for a company if it exists and is younger
 * than SNAPSHOT_TTL_MS. Expired snapshots are removed lazily.
 */
export async function getPreRestoreSnapshot(
  companyId: string,
): Promise<AvailableSnapshot | null> {
  const row = await getMeta<StoredSnapshot>(key(companyId));
  if (!row) return null;
  const ageMs = Date.now() - row.createdAt;
  if (ageMs > SNAPSHOT_TTL_MS) {
    try { await offlineDb.meta.delete(key(companyId)); } catch { /* ignore */ }
    return null;
  }
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    createdAt: row.createdAt,
    ageMs,
    expiresInMs: SNAPSHOT_TTL_MS - ageMs,
  };
}

/**
 * Restore the company from the pre-restore snapshot (the "undo" operation).
 * Wipes current data and rebuilds from the snapshot captured before the
 * previous restore. Removes the snapshot on success.
 */
export async function undoRestore(companyId: string): Promise<void> {
  const row = await getMeta<StoredSnapshot>(key(companyId));
  if (!row) throw new Error("No undo snapshot available");
  const ageMs = Date.now() - row.createdAt;
  if (ageMs > SNAPSHOT_TTL_MS) {
    try { await offlineDb.meta.delete(key(companyId)); } catch { /* ignore */ }
    throw new Error("Undo window (24 hours) has expired");
  }
  await restoreCompanyBackup(companyId, row.payload);
  try { await offlineDb.meta.delete(key(companyId)); } catch { /* ignore */ }
}

export async function clearPreRestoreSnapshot(companyId: string): Promise<void> {
  try { await offlineDb.meta.delete(key(companyId)); } catch { /* ignore */ }
}
