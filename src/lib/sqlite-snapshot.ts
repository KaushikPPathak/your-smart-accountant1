// Daily copy of the desktop SQLite book file, taken at startup with SQLite's own
// VACUUM INTO (a consistent copy even while the app is open). One copy per day, kept
// in <app local data>/db-snapshots. Old copies are NEVER deleted (see backup-policy:
// local backups are kept until the user removes them). A failure never blocks the app.
import { getDb, isTauri } from "@/utils/nativeDb";

export const SNAPSHOT_KEY = "sqlite_snapshot_last_day";
export const SNAPSHOT_DIR = "db-snapshots";

/** Local calendar day as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function snapshotFileName(day: string): string {
  return `smart_accountant-${day}.db`;
}

/** A snapshot is due when none was taken today. */
export function snapshotDue(lastDay: string | null, now: Date): boolean {
  return lastDay !== localDay(now);
}

/** Single-quoted SQL string literal (for the VACUUM INTO target path). */
export function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export interface SnapshotResult {
  status: "skipped" | "taken" | "failed";
  path?: string;
  detail?: string;
}

export async function takeDailySqliteSnapshot(now: Date = new Date()): Promise<SnapshotResult> {
  if (!isTauri()) return { status: "skipped", detail: "not the desktop app" };
  let lastDay: string | null = null;
  try { lastDay = localStorage.getItem(SNAPSHOT_KEY); } catch { /* unavailable */ }
  if (!snapshotDue(lastDay, now)) return { status: "skipped", detail: "already taken today" };
  try {
    const [{ appLocalDataDir, join }, fs] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const dir = await join(await appLocalDataDir(), SNAPSHOT_DIR);
    await fs.mkdir(dir, { recursive: true });
    const path = await join(dir, snapshotFileName(localDay(now)));
    if (!(await fs.exists(path))) {
      const db = await getDb();
      await db.execute(`VACUUM INTO ${sqlLiteral(path)}`);
    }
    try { localStorage.setItem(SNAPSHOT_KEY, localDay(now)); } catch { /* ignore */ }
    return { status: "taken", path };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
