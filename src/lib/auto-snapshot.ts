// Auto safety-snapshot on app launch.
// Writes one JSON snapshot per company per day to:
//   <APPLOCALDATA>/snapshots/<YYYY-MM-DD>/<companySlug>.json
// Survives Windows installer upgrades because APPLOCALDATA is outside Program Files.
// Skipped on web. Failures are silent — this is best-effort safety, not a primary backup.

import { buildCompanyBackup } from "./backup";
import { wrapBackup } from "./backup-policy";
import { isDesktopRuntime, writeAbsoluteFileNative } from "./native-bridge";
import { getAppPaths } from "./app-paths";

const RUN_KEY = "ym_last_auto_snapshot_day";

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
        const envelope = await wrapBackup(payload);
        const contents = JSON.stringify(envelope);
        const fileName = `${safeName(c.name)}.json`;
        await writeAbsoluteFileNative(root, subDir, fileName, contents);
      } catch {
        /* per-company failure — keep going */
      }
    }
    try { localStorage.setItem(RUN_KEY, today); } catch { /* ignore */ }
  } catch {
    /* silent */
  }
}
