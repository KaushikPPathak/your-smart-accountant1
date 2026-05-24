// Silent on-launch data migrations for the desktop app.
//
// Runs once per app boot. Reads <appLocalDataDir>/state/app_data_version.json,
// determines the schema version, and runs ordered idempotent migration steps
// to bring it to CURRENT_DATA_VERSION. Migrations are silent (no UI prompts)
// — failures are logged to <logs>/migrations.log and abort the chain so we
// don't half-migrate.

import { getAppPaths } from "./app-paths";

export const CURRENT_DATA_VERSION = 1;

interface VersionFile {
  version: number;
  migrated_from?: string;
  history?: { from: number; to: number; at: string; note?: string }[];
  updated_at: string;
}

function hasTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

async function ensureDirs(): Promise<void> {
  if (!hasTauri()) return;
  const paths = await getAppPaths();
  if (!paths) return;
  const fs = await import("@tauri-apps/plugin-fs");
  await Promise.all([
    fs.mkdir(paths.root, { recursive: true }).catch(() => undefined),
    fs.mkdir(paths.mirror, { recursive: true }).catch(() => undefined),
    fs.mkdir(paths.exports, { recursive: true }).catch(() => undefined),
    fs.mkdir(paths.backups, { recursive: true }).catch(() => undefined),
    fs.mkdir(paths.state, { recursive: true }).catch(() => undefined),
    fs.mkdir(paths.logs, { recursive: true }).catch(() => undefined),
  ]);
}

async function versionFilePath(): Promise<string | null> {
  if (!hasTauri()) return null;
  const paths = await getAppPaths();
  if (!paths) return null;
  const { join } = await import("@tauri-apps/api/path");
  return join(paths.state, "app_data_version.json");
}

async function readVersion(): Promise<VersionFile | null> {
  if (!hasTauri()) return null;
  const fp = await versionFilePath();
  if (!fp) return null;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const exists = await fs.exists(fp);
    if (!exists) return null;
    const txt = await fs.readTextFile(fp);
    return JSON.parse(txt) as VersionFile;
  } catch {
    return null;
  }
}

async function writeVersion(v: VersionFile): Promise<void> {
  if (!hasTauri()) return;
  const fp = await versionFilePath();
  if (!fp) return;
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.writeTextFile(fp, JSON.stringify(v, null, 2));
}

async function appendLog(line: string): Promise<void> {
  if (!hasTauri()) return;
  try {
    const paths = await getAppPaths();
    if (!paths) return;
    const { join } = await import("@tauri-apps/api/path");
    const fs = await import("@tauri-apps/plugin-fs");
    const fp = await join(paths.logs, "migrations.log");
    const prev = (await fs.exists(fp)) ? await fs.readTextFile(fp) : "";
    await fs.writeTextFile(fp, prev + `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* logging best-effort */
  }
}

// ---------- Step implementations ----------

/**
 * Migrate legacy `Documents\YourMehtaji\Exports\<Company>\...` content into
 * `<appLocalDataDir>/mirror/<Company>/...`. Idempotent: if the legacy folder
 * is missing, no-op.
 */
async function migrateLegacyDocumentsFolder(): Promise<{ moved: number }> {
  if (!hasTauri()) return { moved: 0 };
  const paths = await getAppPaths();
  if (!paths) return { moved: 0 };

  const { documentDir, join } = await import("@tauri-apps/api/path");
  const fs = await import("@tauri-apps/plugin-fs");

  const docs = await documentDir();
  const legacyRoot = await join(docs, "YourMehtaji", "Exports");
  const legacyExists = await fs.exists(legacyRoot).catch(() => false);
  if (!legacyExists) return { moved: 0 };

  let moved = 0;
  try {
    const entries = await fs.readDir(legacyRoot);
    for (const ent of entries) {
      if (!ent.isDirectory || !ent.name) continue;
      const src = await join(legacyRoot, ent.name);
      const dst = await join(paths.mirror, ent.name);
      const dstExists = await fs.exists(dst).catch(() => false);
      if (dstExists) continue; // never clobber an existing target
      await copyDirRecursive(src, dst);
      moved += 1;
    }
    // Breadcrumb so the user knows where their data went.
    const note = await join(legacyRoot, "MOVED.txt");
    await fs.writeTextFile(
      note,
      `Smart Accountant moved its local snapshots to:\n  ${paths.mirror}\nMoved at: ${new Date().toISOString()}\n`,
    );
  } catch (err) {
    await appendLog(`legacy-docs migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { moved };
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  const fs = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  await fs.mkdir(dst, { recursive: true }).catch(() => undefined);
  const entries = await fs.readDir(src);
  for (const ent of entries) {
    if (!ent.name) continue;
    const s = await join(src, ent.name);
    const d = await join(dst, ent.name);
    if (ent.isDirectory) {
      await copyDirRecursive(s, d);
    } else {
      try {
        const data = await fs.readFile(s);
        await fs.writeFile(d, data);
      } catch {
        // Fallback: treat as text.
        try {
          const txt = await fs.readTextFile(s);
          await fs.writeTextFile(d, txt);
        } catch {
          /* skip unreadable file */
        }
      }
    }
  }
}

// ---------- Runner ----------

export interface MigrationResult {
  ran: boolean;
  fromVersion: number | null;
  toVersion: number;
  steps: string[];
  error?: string;
}

let inflight: Promise<MigrationResult> | null = null;

export async function runAppDataMigrationsOnce(): Promise<MigrationResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!hasTauri()) {
      return { ran: false, fromVersion: null, toVersion: CURRENT_DATA_VERSION, steps: [] };
    }
    try {
      await ensureDirs();
      const existing = await readVersion();
      const fromVersion = existing?.version ?? null;
      const steps: string[] = [];

      if (existing && existing.version > CURRENT_DATA_VERSION) {
        await appendLog(`downgrade detected (file=${existing.version}, app=${CURRENT_DATA_VERSION}) — no-op`);
        return { ran: false, fromVersion, toVersion: existing.version, steps };
      }

      if (!existing) {
        // First boot under the new layout: pull anything legacy in.
        const { moved } = await migrateLegacyDocumentsFolder();
        steps.push(`legacy_documents_moved=${moved}`);
        await writeVersion({
          version: CURRENT_DATA_VERSION,
          migrated_from: "legacy_documents",
          history: [{ from: 0, to: CURRENT_DATA_VERSION, at: new Date().toISOString(), note: `moved ${moved} company folder(s)` }],
          updated_at: new Date().toISOString(),
        });
        await appendLog(`initialized at v${CURRENT_DATA_VERSION} (moved ${moved} legacy folder(s))`);
        return { ran: true, fromVersion, toVersion: CURRENT_DATA_VERSION, steps };
      }

      if (existing.version < CURRENT_DATA_VERSION) {
        // No incremental steps registered yet — when v2 lands, add a switch
        // here that runs v1→v2, v2→v3, etc. each wrapped in its own try.
        await writeVersion({
          ...existing,
          version: CURRENT_DATA_VERSION,
          history: [
            ...(existing.history ?? []),
            { from: existing.version, to: CURRENT_DATA_VERSION, at: new Date().toISOString() },
          ],
          updated_at: new Date().toISOString(),
        });
        steps.push(`bumped ${existing.version}->${CURRENT_DATA_VERSION}`);
        await appendLog(`bumped v${existing.version} -> v${CURRENT_DATA_VERSION}`);
      }

      return { ran: true, fromVersion, toVersion: CURRENT_DATA_VERSION, steps };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendLog(`MIGRATION FAILED: ${msg}`);
      return {
        ran: false,
        fromVersion: null,
        toVersion: CURRENT_DATA_VERSION,
        steps: [],
        error: msg,
      };
    }
  })();
  return inflight;
}
