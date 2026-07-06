// Silent auto-restore on launch.
//
// Rule (see .lovable/memory/constraints/auto-restore-silent.md):
//   If the manifest says company X had N > 0 rows and the live IndexedDB
//   now has 0 rows (or < 50 % of N), pick the newest VALID snapshot for X
//   and restore it in the background. The user sees only a small toast,
//   never a prompt.
//
// This is the last line of defence against WebView profile orphaning,
// installer glitches, or IndexedDB corruption. It runs BEFORE the daily
// auto-snapshot so we never overwrite good snapshots with empty ones.

import { isDesktopRuntime } from "@/lib/native-bridge";
import { getAppPaths } from "@/lib/app-paths";
import { getAllIntegrity, countLive, totalRows, recordIntegrityFromSnapshot, type IntegrityEntry } from "@/lib/integrity";
import { parseBackupFile, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
import { setMeta, getMeta } from "@/lib/offline/db";

export interface AutoRestoreOutcome {
  companyId: string;
  companyName: string;
  status: "ok" | "restored" | "no-snapshot" | "no-manifest" | "skipped-fresh" | "failed";
  restoredFrom?: string;      // absolute file path
  restoredAtIso?: string;
  liveBefore?: number;
  liveAfter?: number;
  manifestTotal?: number;
  /** Vouchers missing at detection time (manifestVouchers - liveVouchers, clamped ≥0). */
  missingVouchers?: number;
  /** Total vouchers the manifest expected. */
  manifestVouchers?: number;
  error?: string;
}

const EVENTS_KEY = "auto_restore_events";

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

interface SnapshotCandidate {
  absPath: string;
  dateFolder: string;   // YYYY-MM-DD
  fileName: string;
}

async function listSnapshotsForCompany(companyName: string): Promise<SnapshotCandidate[]> {
  if (!isDesktopRuntime()) return [];
  try {
    const paths = await getAppPaths();
    if (!paths) return [];
    const [{ join }, fs] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const snapRoot = await join(paths.root, "snapshots");
    let dateDirs: { name?: string; isDirectory?: boolean }[] = [];
    try {
      const raw = await fs.readDir(snapRoot);
      dateDirs = raw as unknown as { name?: string; isDirectory?: boolean }[];
    } catch { return []; }
    const target = safeName(companyName);
    const out: SnapshotCandidate[] = [];
    for (const d of dateDirs) {
      const dateName = d.name;
      if (!dateName) continue;
      const dir = await join(snapRoot, dateName);
      let entries: { name?: string }[] = [];
      try {
        const raw = await fs.readDir(dir);
        entries = raw as unknown as { name?: string }[];
      } catch { continue; }
      for (const e of entries) {
        if (!e.name || !e.name.endsWith(".json")) continue;
        const base = e.name.replace(/\.json$/, "");
        // Match either exact safeName or "<safeName>_backup_*"
        if (base === target || base.startsWith(`${target}_backup_`)) {
          out.push({ absPath: await join(dir, e.name), dateFolder: dateName, fileName: e.name });
        }
      }
    }
    // Newest first (folder name is YYYY-MM-DD → sortable string)
    out.sort((a, b) => (b.dateFolder + b.fileName).localeCompare(a.dateFolder + a.fileName));
    return out;
  } catch { return []; }
}

async function readAndParse(absPath: string): Promise<CompanyBackup | null> {
  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const text = await readTextFile(absPath);
    const parsed = await parseBackupFile(text);
    // Only single-company snapshots are auto-restored. Multi-company backups
    // are user-driven — they involve picking a mapping.
    if (parsed.kind !== "single") return null;
    // Checksum: envelope files return `checksumOk`. Refuse when explicitly false.
    if ((parsed as { checksumOk?: boolean }).checksumOk === false) return null;
    return parsed.data;
  } catch { return null; }
}

async function logEvent(o: AutoRestoreOutcome): Promise<void> {
  try {
    const prev = (await getMeta<AutoRestoreOutcome[]>(EVENTS_KEY)) ?? [];
    prev.unshift({ ...o, restoredAtIso: new Date().toISOString() });
    await setMeta(EVENTS_KEY, prev.slice(0, 50));
  } catch { /* ignore */ }
}

export async function getAutoRestoreEvents(): Promise<AutoRestoreOutcome[]> {
  return (await getMeta<AutoRestoreOutcome[]>(EVENTS_KEY)) ?? [];
}

function classify(manifest: IntegrityEntry | null, live: { ledgers: number; items: number; vouchers: number }): "ok" | "empty" | "shrunk" | "no-manifest" | "fresh" {
  if (!manifest) return live.ledgers + live.items + live.vouchers === 0 ? "fresh" : "no-manifest";
  const mTotal = totalRows(manifest);
  const lTotal = live.ledgers + live.items + live.vouchers;
  if (mTotal === 0) return "ok";
  if (lTotal === 0) return "empty";
  if (lTotal < mTotal * 0.5) return "shrunk";
  return "ok";
}

/**
 * Run the silent self-check for every known company. Returns one outcome
 * per company. Never throws — errors are captured in each outcome.
 */
export async function runAutoRestore(
  companies: { id: string; name: string }[],
): Promise<AutoRestoreOutcome[]> {
  if (companies.length === 0) return [];
  const manifest = await getAllIntegrity();
  const results: AutoRestoreOutcome[] = [];
  for (const c of companies) {
    const m = manifest[c.id] ?? null;
    const live = await countLive(c.id);
    const cls = classify(m, live);
    if (cls === "ok") {
      results.push({ companyId: c.id, companyName: c.name, status: "ok", liveBefore: live.ledgers + live.items + live.vouchers, manifestTotal: m ? totalRows(m) : 0 });
      continue;
    }
    if (cls === "fresh" || cls === "no-manifest") {
      results.push({ companyId: c.id, companyName: c.name, status: "skipped-fresh", liveBefore: live.ledgers + live.items + live.vouchers, manifestTotal: m ? totalRows(m) : 0 });
      continue;
    }
    // cls === "empty" or "shrunk" — try to restore silently.
    const candidates = await listSnapshotsForCompany(c.name);
    let restored: { path: string; payload: CompanyBackup } | null = null;
    for (const cand of candidates) {
      const payload = await readAndParse(cand.absPath);
      if (!payload) continue;
      const total = (payload.ledgers?.length ?? 0) + (payload.items?.length ?? 0) + (payload.vouchers?.length ?? 0);
      if (m && total < totalRows(m) * 0.5) continue; // skip suspiciously small
      if (total === 0) continue;
      restored = { path: cand.absPath, payload };
      break;
    }
    const manifestVouchers = m?.vouchers ?? 0;
    const missingVouchers = Math.max(0, manifestVouchers - live.vouchers);
    if (!restored) {
      const out: AutoRestoreOutcome = {
        companyId: c.id, companyName: c.name, status: "no-snapshot",
        liveBefore: live.ledgers + live.items + live.vouchers,
        manifestTotal: m ? totalRows(m) : 0,
        manifestVouchers, missingVouchers,
      };
      results.push(out);
      await logEvent(out);
      continue;
    }
    try {
      await restoreCompanyBackup(c.id, restored.payload);
      const after = await countLive(c.id);
      // Refresh manifest to reflect the restored state.
      await recordIntegrityFromSnapshot(c.id, c.name, restored.payload, { file: restored.path });
      const out: AutoRestoreOutcome = {
        companyId: c.id, companyName: c.name, status: "restored",
        restoredFrom: restored.path,
        liveBefore: live.ledgers + live.items + live.vouchers,
        liveAfter: after.ledgers + after.items + after.vouchers,
        manifestTotal: m ? totalRows(m) : 0,
        manifestVouchers, missingVouchers,
      };
      results.push(out);
      await logEvent(out);
    } catch (e) {
      const out: AutoRestoreOutcome = {
        companyId: c.id, companyName: c.name, status: "failed",
        error: e instanceof Error ? e.message : String(e),
        liveBefore: live.ledgers + live.items + live.vouchers,
        manifestTotal: m ? totalRows(m) : 0,
        manifestVouchers, missingVouchers,
      };
      results.push(out);
      await logEvent(out);
    }
  }
  return results;
}
