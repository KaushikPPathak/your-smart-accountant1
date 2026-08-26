// Fresh-install legacy backup discovery.
//
// A genuinely fresh installation has ZERO companies in IndexedDB, so the
// existing snapshot auto-restore (which iterates known companies) never runs.
// This module closes that gap: on desktop, when the local company count is
// zero, it scans ONLY the two approved legacy backup roots, validates the
// files with the existing `parseBackupFile()`, picks the newest valid backup
// per company and restores it through the existing NON-DESTRUCTIVE
// `recoverMissingFromSnapshot()` (which preserves original IDs).
//
// Hard rules:
//   • never scan C:\ (or any root other than the two approved ones),
//   • never overwrite an existing company,
//   • never resurrect a tombstoned company,
//   • integrity.json is NOT required,
//   • one bad backup must not stop the other companies/roots.

import {
  isDesktopRuntime,
  getLegacyScanRootsNative,
  listDirectoriesNative,
  readLegacyTextFileNative,
} from "@/lib/native-bridge";

export interface LegacyBackupCandidate {
  companyId: string;
  companyName: string;
  path: string;
  exportedAt: string;
  /** Parsed CompanyBackup payload. */
  backup: any;
}

export interface LegacyDiscoveryResult {
  ran: boolean;
  roots: string[];
  candidates: number;
  valid: number;
  invalid: number;
  restored: number;
  skipped: number;
  restoredCompanyIds: string[];
  invalidPaths: string[];
  errors: string[];
}

function emptyResult(): LegacyDiscoveryResult {
  return {
    ran: false,
    roots: [],
    candidates: 0,
    valid: 0,
    invalid: 0,
    restored: 0,
    skipped: 0,
    restoredCompanyIds: [],
    invalidPaths: [],
    errors: [],
  };
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

function timeOf(iso: unknown): number {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? t : 0;
}

/** Newest wins; identical timestamps fall back to a deterministic path order. */
function isNewer(next: LegacyBackupCandidate, current: LegacyBackupCandidate): boolean {
  const a = timeOf(next.exportedAt);
  const b = timeOf(current.exportedAt);
  if (a !== b) return a > b;
  return next.path.localeCompare(current.path) > 0;
}

/**
 * Enumerate `<root>/<Company>/backups/*.json` for every approved root and
 * return the newest VALID backup per company id.
 */
export async function findLegacyBackupCandidates(
  result: LegacyDiscoveryResult,
): Promise<Map<string, LegacyBackupCandidate>> {
  const { parseBackupFile } = await import("@/lib/backup");
  const best = new Map<string, LegacyBackupCandidate>();

  for (const root of result.roots) {
    let companyDirs: string[] = [];
    try {
      const listing = await listDirectoriesNative(root);
      if (!listing?.ok || !listing.entries) continue; // broken root must not block the other one
      companyDirs = listing.entries;
    } catch (err) {
      result.errors.push(`root ${root}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const companyDir of companyDirs) {
      if (!companyDir || companyDir.startsWith(".")) continue;
      const backupsDir = joinPath(root, companyDir, "backups");
      let files: string[] = [];
      try {
        const listing = await listDirectoriesNative(backupsDir);
        if (!listing?.ok || !listing.entries) continue;
        files = listing.entries.filter((n) => /\.json$/i.test(n));
      } catch {
        continue;
      }

      for (const file of files) {
        const fullPath = joinPath(backupsDir, file);
        result.candidates++;
        try {
          const read = await readLegacyTextFileNative(fullPath);
          if (!read?.ok || typeof read.text !== "string") {
            result.invalid++;
            result.invalidPaths.push(fullPath);
            continue;
          }
          const parsed = await parseBackupFile(read.text);
          if (parsed.kind !== "single" || parsed.checksumOk === false) {
            result.invalid++;
            result.invalidPaths.push(fullPath);
            continue;
          }
          const data = parsed.data as any;
          const companyId = String(data?.company?.id ?? data?.company?.company_id ?? "");
          if (!companyId) {
            result.invalid++;
            result.invalidPaths.push(fullPath);
            continue;
          }
          result.valid++;
          const candidate: LegacyBackupCandidate = {
            companyId,
            companyName: String(data?.company?.name ?? "Recovered Company"),
            path: fullPath,
            exportedAt: String(data?.exported_at ?? ""),
            backup: data,
          };
          const current = best.get(companyId);
          if (!current || isNewer(candidate, current)) best.set(companyId, candidate);
        } catch {
          result.invalid++;
          result.invalidPaths.push(fullPath);
        }
      }
    }
  }

  return best;
}

/**
 * Fresh-install entry point. Safe to call on every startup: it exits
 * immediately unless the local database has zero companies.
 */
export async function discoverAndRestoreLegacyBackups(): Promise<LegacyDiscoveryResult> {
  const result = emptyResult();
  if (!isDesktopRuntime()) return result;

  const { offlineDb } = await import("@/lib/offline/db");

  // Only ever run on a genuinely empty install — existing data is authoritative.
  const existingCount = await offlineDb.companies.count();
  if (existingCount > 0) return result;

  const rootsRes = await getLegacyScanRootsNative();
  const roots = (rootsRes?.ok && rootsRes.roots ? rootsRes.roots : []).filter(Boolean);
  if (roots.length === 0) return result;

  result.ran = true;
  result.roots = roots;

  const best = await findLegacyBackupCandidates(result);
  if (best.size === 0) return result;

  const [{ recoverMissingFromSnapshot }, { isTombstoned }] = await Promise.all([
    import("@/lib/backup"),
    import("@/lib/recovery/tombstones"),
  ]);

  for (const candidate of best.values()) {
    try {
      if (await isTombstoned(candidate.companyId, candidate.companyName)) {
        result.skipped++;
        continue;
      }

      // Re-check immediately before restoring: never overwrite an existing company.
      const existing = await offlineDb.companies.get(candidate.companyId);
      if (existing) {
        result.skipped++;
        continue;
      }

      // Non-destructive, ID-preserving restore through the existing engine.
      await recoverMissingFromSnapshot(candidate.companyId, candidate.backup);

      const verified = await offlineDb.companies.get(candidate.companyId);
      if (verified) {
        result.restored++;
        result.restoredCompanyIds.push(candidate.companyId);
      } else {
        result.errors.push(`Restore verification failed for ${candidate.companyId}`);
      }
    } catch (err) {
      // One failing company must never stop the others.
      result.errors.push(
        `${candidate.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
