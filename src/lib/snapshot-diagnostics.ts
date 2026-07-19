// Snapshot-write diagnostics.
//
// The old `runAutoSnapshotOnce()` caught every error silently. If Tauri's fs
// plugin scope was wrong, or the drive was full, or antivirus blocked the
// write, the app would still show "Healthy" in Data Health while writing
// nothing to disk. That is the exact class of bug that caused the July 2026
// data loss incident on Kaushik's PC (snapshots folder never created).
//
// This module records the outcome of every snapshot run into IndexedDB so:
//   - Data Health can show a red "Snapshot writes failing" badge.
//   - App startup can raise a one-time warning toast.
//   - We have a paper trail when a user reports "my snapshots are missing".

import { getMeta, setMeta } from "@/lib/offline/db";

const KEY = "snapshot_run_events";
const MAX_EVENTS = 50;

export interface SnapshotRunEvent {
  atIso: string;
  target?: string;          // full path or subFolder we tried to write to
  companyId?: string;
  companyName?: string;
  status: "ok" | "empty-skipped" | "no-paths" | "write-failed" | "no-desktop";
  rows?: number;
  error?: string;
}

export async function recordSnapshotEvent(e: Omit<SnapshotRunEvent, "atIso">): Promise<void> {
  try {
    const prev = (await getMeta<SnapshotRunEvent[]>(KEY)) ?? [];
    prev.unshift({ ...e, atIso: new Date().toISOString() });
    await setMeta(KEY, prev.slice(0, MAX_EVENTS));
  } catch { /* ignore */ }
}

export async function getSnapshotEvents(): Promise<SnapshotRunEvent[]> {
  return (await getMeta<SnapshotRunEvent[]>(KEY)) ?? [];
}

/** True if the most-recent run for any company failed the write. */
export async function snapshotWritesFailing(): Promise<boolean> {
  const events = await getSnapshotEvents();
  if (events.length === 0) return false;
  // Look at the most recent event per company. If the newest one is a
  // failure, snapshots for that company are currently broken.
  const seen = new Set<string>();
  for (const e of events) {
    const k = e.companyId ?? "_";
    if (seen.has(k)) continue;
    seen.add(k);
    if (e.status === "write-failed" || e.status === "no-paths") return true;
  }
  return false;
}

export async function clearSnapshotEvents(): Promise<void> {
  try { await setMeta(KEY, []); } catch { /* ignore */ }
}
