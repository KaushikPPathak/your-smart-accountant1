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
import { buildCompanyBackup, parseBackupFile, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
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
    const target = safeName(companyName);
    const out: SnapshotCandidate[] = [];
    const addJsonFiles = async (dir: string, dateName: string) => {
      let entries: { name?: string }[] = [];
      try {
        const raw = await fs.readDir(dir);
        entries = raw as unknown as { name?: string }[];
      } catch { return; }
      for (const e of entries) {
        if (!e.name || !e.name.endsWith(".json")) continue;
        const base = e.name.replace(/\.json$/, "");
        // Include normal, pre-delete and pre-merge snapshots. Those safety
        // files deliberately prefix the company name, so startsWith() alone
        // made the most valuable recovery files invisible.
        if (base === target || base.includes(target)) {
          out.push({ absPath: await join(dir, e.name), dateFolder: dateName, fileName: e.name });
        }
      }
    };

    // Current layout: <root>/snapshots/<YYYY-MM-DD>/*.json
    const snapRoot = await join(paths.root, "snapshots");
    try {
      const dateDirs = await fs.readDir(snapRoot) as unknown as { name?: string; isDirectory?: boolean }[];
      for (const d of dateDirs) {
        if (!d.name || d.isDirectory === false) continue;
        await addJsonFiles(await join(snapRoot, d.name), d.name);
      }
    } catch { /* legacy installs may not have the nested root */ }

    // July-2026 legacy layout produced by the old writer bug:
    // <root>/snapshots_YYYY-MM-DD/*.json
    try {
      const rootEntries = await fs.readDir(paths.root) as unknown as { name?: string; isDirectory?: boolean }[];
      for (const d of rootEntries) {
        if (!d.name || d.isDirectory === false) continue;
        const match = /^snapshots[_-](\d{4}-\d{2}-\d{2})$/i.exec(d.name);
        if (!match) continue;
        await addJsonFiles(await join(paths.root, d.name), match[1]);
      }
    } catch { /* ignore */ }

    // De-duplicate absolute paths if a platform adapter reports aliases.
    const unique = new Map(out.map((candidate) => [candidate.absPath, candidate]));
    const candidates = Array.from(unique.values());
    // Newest folder first; within a day prefer explicit safety snapshots.
    candidates.sort((a, b) => {
      const byDate = b.dateFolder.localeCompare(a.dateFolder);
      if (byDate) return byDate;
      const safetyA = /^(pre-delete|pre-merge)/i.test(a.fileName) ? 1 : 0;
      const safetyB = /^(pre-delete|pre-merge)/i.test(b.fileName) ? 1 : 0;
      return (safetyB - safetyA) || b.fileName.localeCompare(a.fileName);
    });
    return candidates;
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
  // One missing accounting row matters. The previous 50% threshold allowed
  // a partially loaded company to look healthy even when weeks of vouchers
  // were absent. Restoration is still guarded by the strict superset proof
  // below, so this more sensitive detector cannot overwrite newer work.
  if (live.ledgers < manifest.ledgers || live.items < manifest.items || live.vouchers < manifest.vouchers) return "shrunk";
  return "ok";
}

function normalizedIdentity(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function companyNameFromBackup(backup: CompanyBackup): string {
  return String((backup.company as { name?: unknown } | null)?.name ?? "");
}

function voucherFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.voucher_date ?? row.date ?? "",
    String(row.voucher_type ?? row.type ?? "").toLocaleLowerCase(),
    String(row.voucher_number ?? row.number ?? "").trim(),
    Number(row.total_amount_paise ?? row.total_paise ?? row.total_amount ?? row.amount ?? row.grand_total ?? 0),
  ]);
}

function multisetContains(
  candidate: Record<string, unknown>[],
  live: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string,
): boolean {
  const counts = new Map<string, number>();
  for (const row of candidate) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of live) {
    const key = keyOf(row);
    const remaining = counts.get(key) ?? 0;
    if (remaining < 1) return false;
    counts.set(key, remaining - 1);
  }
  return true;
}

/**
 * A snapshot may silently replace live books only when it demonstrably
 * contains every live voucher, ledger and item plus additional vouchers.
 * This prevents an older but larger backup from deleting newer work.
 */
export function isBackupSafeSuperset(candidate: CompanyBackup, live: CompanyBackup): boolean {
  const candidateCounts = [candidate.vouchers?.length ?? 0, candidate.ledgers?.length ?? 0, candidate.items?.length ?? 0];
  const liveCounts = [live.vouchers?.length ?? 0, live.ledgers?.length ?? 0, live.items?.length ?? 0];
  if (candidateCounts.some((count, index) => count < liveCounts[index])) return false;
  if (!candidateCounts.some((count, index) => count > liveCounts[index])) return false;
  const byName = (row: Record<string, unknown>) => normalizedIdentity(row.name);
  return (
    multisetContains(candidate.vouchers ?? [], live.vouchers ?? [], voucherFingerprint) &&
    multisetContains(candidate.ledgers ?? [], live.ledgers ?? [], byName) &&
    multisetContains(candidate.items ?? [], live.items ?? [], byName)
  );
}

function bestManifestForCompany(
  map: Record<string, IntegrityEntry>,
  company: { id: string; name: string },
): IntegrityEntry | null {
  const wanted = normalizedIdentity(company.name);
  const matches = Object.values(map).filter((entry) =>
    entry.companyId === company.id || normalizedIdentity(entry.companyName) === wanted,
  );
  matches.sort((a, b) =>
    (b.vouchers - a.vouchers) || (totalRows(b) - totalRows(a)) || (b.lastGoodAt - a.lastGoodAt),
  );
  return matches[0] ?? null;
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
    // A deleted duplicate company may have held the fuller lineage under a
    // different ID. Company name ties those on-device manifests together;
    // the strict superset check below is the final safety gate.
    const m = bestManifestForCompany(manifest, c);
    const live = await countLive(c.id);
    const cls = classify(m, live);
    if (cls === "ok") {
      results.push({ companyId: c.id, companyName: c.name, status: "ok", liveBefore: live.ledgers + live.items + live.vouchers, manifestTotal: m ? totalRows(m) : 0 });
      continue;
    }
    // With no manifest, a non-empty live company is still checked against
    // on-disk history. The superset proof makes this safe and repairs older
    // installations created before integrity.json existed. A truly fresh,
    // empty company remains untouched because there is no live lineage to
    // prove against.
    if (cls === "fresh") {
      results.push({ companyId: c.id, companyName: c.name, status: "skipped-fresh", liveBefore: 0, manifestTotal: 0 });
      continue;
    }
    // cls === "empty", "shrunk" or "no-manifest" — inspect snapshots.
    const candidates = await listSnapshotsForCompany(c.name);
    const livePayload = await buildCompanyBackup(c.id);
    const valid: { path: string; payload: CompanyBackup; dateFolder: string }[] = [];
    for (const cand of candidates) {
      const payload = await readAndParse(cand.absPath);
      if (!payload) continue;
      const sourceName = normalizedIdentity(companyNameFromBackup(payload));
      if (sourceName && sourceName !== normalizedIdentity(c.name)) continue;
      const total = (payload.ledgers?.length ?? 0) + (payload.items?.length ?? 0) + (payload.vouchers?.length ?? 0);
      if (total === 0) continue;
      if (!isBackupSafeSuperset(payload, livePayload)) continue;
      valid.push({ path: cand.absPath, payload, dateFolder: cand.dateFolder });
    }
    // Prefer the richest verified lineage, not merely the newest filename.
    // This is essential when a partial daily snapshot and a fuller pre-merge
    // or pre-delete safety snapshot were written on the same date.
    valid.sort((a, b) => {
      const voucherDiff = (b.payload.vouchers?.length ?? 0) - (a.payload.vouchers?.length ?? 0);
      if (voucherDiff) return voucherDiff;
      const rows = (p: CompanyBackup) =>
        (p.ledgers?.length ?? 0) + (p.items?.length ?? 0) + (p.vouchers?.length ?? 0) +
        (p.voucher_entries?.length ?? 0) + (p.voucher_items?.length ?? 0);
      return (rows(b.payload) - rows(a.payload)) || b.dateFolder.localeCompare(a.dateFolder);
    });
    const restored = valid[0] ?? null;
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
