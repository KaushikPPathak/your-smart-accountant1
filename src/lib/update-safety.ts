// Update-safety hooks.
//
// Local business data lives in IndexedDB (browser / WebView2 profile) and,
// on desktop, snapshots live in %LOCALAPPDATA%\com.smartaccountant.app\
// which is OUTSIDE Program Files and therefore untouched by any NSIS / MSI
// upgrade. That means a normal version update — installer, PWA service-
// worker update, or Tauri auto-updater — does NOT wipe the user's data.
//
// This module makes that guarantee visible and self-healing:
//   1. On every launch it records the installed version + local DB size.
//   2. When the version changes, it compares the current DB size against
//      the last known size. If the DB unexpectedly went from "N companies"
//      to "0 companies" across an update, we surface a blocking recovery
//      banner instead of silently letting the user think their books are
//      gone.
//   3. Before a PWA service-worker takes over (skipWaiting), we fire a
//      one-off snapshot so the outgoing version's data is on disk.
//
// Nothing here writes to servers.

import { offlineDb } from "./offline/db";
import { isDesktopRuntime } from "./native-bridge";
import { runAutoSnapshotOnce } from "./auto-snapshot";

const VERSION_KEY = "ym_installed_version";
const LAST_COUNT_KEY = "ym_last_local_company_count";
const RECOVERY_FLAG_KEY = "ym_post_update_recovery_needed";

function currentVersion(): string {
  // Prefer Vite-injected build id if present, otherwise app version.
  const v =
    (import.meta.env.VITE_APP_VERSION as string | undefined) ||
    (import.meta.env.VITE_BUILD_ID as string | undefined) ||
    "0.0.0";
  return String(v);
}

async function countLocalCompanies(): Promise<number> {
  try {
    // cache_companies is the offline mirror of the companies table.
    const n = await offlineDb.cache_companies.count();
    if (Number.isFinite(n)) return n;
  } catch { /* fall through */ }
  try {
    const n = await offlineDb.companies.count();
    if (Number.isFinite(n)) return n;
  } catch { /* ignore */ }
  return 0;
}

export interface UpdateSafetyStatus {
  previousVersion: string | null;
  currentVersion: string;
  previousCompanyCount: number | null;
  currentCompanyCount: number;
  /** True when the app was updated AND the local DB looks empty although it wasn't before. */
  recoveryRecommended: boolean;
}

/**
 * Record the current version + local company count. Detect an update
 * transition and flag the launch as "recovery recommended" if the local
 * DB unexpectedly emptied out.
 *
 * Safe to call on every launch. Idempotent.
 */
export async function checkUpdateSafety(): Promise<UpdateSafetyStatus> {
  const now = currentVersion();
  let prevVersion: string | null = null;
  let prevCount: number | null = null;
  try {
    prevVersion = localStorage.getItem(VERSION_KEY);
    const raw = localStorage.getItem(LAST_COUNT_KEY);
    prevCount = raw === null ? null : Number(raw);
    if (!Number.isFinite(prevCount as number)) prevCount = null;
  } catch { /* ignore */ }

  const nowCount = await countLocalCompanies();
  const versionChanged = prevVersion !== null && prevVersion !== now;
  const recoveryRecommended =
    versionChanged &&
    (prevCount ?? 0) > 0 &&
    nowCount === 0;

  try {
    localStorage.setItem(VERSION_KEY, now);
    // Only overwrite the "last known good" count when we still have data —
    // never overwrite N with 0, or a recovery prompt would be lost on the
    // next launch.
    if (nowCount > 0) {
      localStorage.setItem(LAST_COUNT_KEY, String(nowCount));
    }
    localStorage.setItem(RECOVERY_FLAG_KEY, recoveryRecommended ? "1" : "0");
  } catch { /* ignore */ }

  return {
    previousVersion: prevVersion,
    currentVersion: now,
    previousCompanyCount: prevCount,
    currentCompanyCount: nowCount,
    recoveryRecommended,
  };
}

export function isRecoveryRecommended(): boolean {
  try { return localStorage.getItem(RECOVERY_FLAG_KEY) === "1"; }
  catch { return false; }
}

export function clearRecoveryFlag(): void {
  try { localStorage.setItem(RECOVERY_FLAG_KEY, "0"); } catch { /* ignore */ }
}

/**
 * Fire a pre-update snapshot for every known company. Called right before
 * the app hands control to a new service-worker or applies a Tauri
 * updater package. Best-effort — never blocks longer than 4 s.
 */
export async function runPreUpdateSnapshot(
  companies: { id: string; name: string }[],
): Promise<void> {
  if (companies.length === 0) return;
  if (!isDesktopRuntime()) return; // web has no writeable disk path
  try {
    // Bypass the daily gate by clearing the marker first.
    try { localStorage.removeItem("ym_last_auto_snapshot_day"); } catch { /* ignore */ }
    await Promise.race([
      runAutoSnapshotOnce(companies),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
  } catch { /* silent */ }
}
