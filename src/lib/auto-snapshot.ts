// Auto safety-snapshot on app launch.
// Writes one JSON snapshot per company per day to:
//   <APPLOCALDATA>/snapshots/<YYYY-MM-DD>/<companySlug>.json
// Survives Windows installer upgrades because APPLOCALDATA is outside Program Files.
// Skipped on web. Failures are silent — this is best-effort safety, not a primary backup.
//
// SAFETY RULE (see .lovable/memory/index.md):
//   We NEVER overwrite an existing non-empty snapshot for the same day with
//   an empty payload. A payload with zero business rows (0 ledgers, 0 items,
//   0 vouchers) is treated as suspect — the user's IndexedDB might be
//   transiently unreadable — and the existing good file is preserved.
//
// After each successful write we record the row counts into the integrity
// manifest so `runAutoRestore()` can distinguish "user started fresh" from
// "profile got orphaned".

import { buildCompanyBackup } from "./backup";
import { wrapBackup, isBackupEnvelope, verifyEnvelope, type BackupEnvelope } from "./backup-policy";
import { isDesktopRuntime, writeAbsoluteFileNative, readAbsoluteTextFileNative } from "./native-bridge";
import { getAppPaths } from "./app-paths";
import { recordIntegrityFromSnapshot } from "./integrity";
import { recordSnapshotEvent } from "./snapshot-diagnostics";
import type { CompanyBackup } from "./backup";

const RUN_KEY = "ym_last_auto_snapshot_day";

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function rowsIn(p: CompanyBackup): number {
  return (p.ledgers?.length ?? 0) + (p.items?.length ?? 0) + (p.vouchers?.length ?? 0);
}

async function existingSnapshotRows(absPath: string): Promise<number | null> {
  try {
    const res = await readAbsoluteTextFileNative(absPath);
    if (!res.ok || !res.text) return null;
    const j = JSON.parse(res.text) as unknown;
    let payload: CompanyBackup | null = null;
    if (isBackupEnvelope(j)) {
      // Trust the envelope only if the checksum passes.
      const ok = await verifyEnvelope(j as BackupEnvelope<CompanyBackup>);
      if (!ok) return null;
      payload = (j as BackupEnvelope<CompanyBackup>).payload as CompanyBackup;
    } else if (j && typeof j === "object" && typeof (j as CompanyBackup).schema_version === "number") {
      payload = j as CompanyBackup;
    }
    if (!payload) return null;
    return rowsIn(payload);
  } catch { return null; }
}

export async function runAutoSnapshotOnce(
  companies: { id: string; name: string }[],
): Promise<void> {
  if (!isDesktopRuntime() || companies.length === 0) return;
  try {
    const last = typeof window !== "undefined" ? localStorage.getItem(RUN_KEY) : null;
    const today = todayKey();
    if (last === today) return; // already ran today
    const paths = await getAppPaths();
    if (!paths) return;
    const root = paths.root.replace(/[\\/]+$/, "");
    const subDir = `snapshots/${today}`;
    for (const c of companies) {
      try {
        const payload = await buildCompanyBackup(c.id);
        const rows = rowsIn(payload);
        const fileName = `${safeName(c.name)}.json`;

        // Refuse to overwrite a non-empty snapshot with an empty one.
        if (rows === 0) {
          const { join } = await import("@tauri-apps/api/path");
          const absPath = await join(root, subDir, fileName);
          const existing = await existingSnapshotRows(absPath);
          if (existing !== null && existing > 0) {
            // Preserve the good file — do NOT write, do NOT touch integrity.
            continue;
          }
        }

        const envelope = await wrapBackup(payload);
        const contents = JSON.stringify(envelope);
        const res = await writeAbsoluteFileNative(root, subDir, fileName, contents);
        if (res.ok && rows > 0) {
          await recordIntegrityFromSnapshot(c.id, c.name, payload, { file: res.path ?? fileName, dir: subDir });
        }
      } catch {
        /* per-company failure — keep going */
      }
    }
    try { localStorage.setItem(RUN_KEY, today); } catch { /* ignore */ }
  } catch {
    /* silent */
  }
}

/** Force a fresh snapshot run right now, bypassing the daily gate. Used
 *  after bulk operations (import, year-end, restore) so the newly-written
 *  state is captured immediately, and by pre-update snapshot. */
export async function runAutoSnapshotForce(companies: { id: string; name: string }[]): Promise<void> {
  try { localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
  await runAutoSnapshotOnce(companies);
}
