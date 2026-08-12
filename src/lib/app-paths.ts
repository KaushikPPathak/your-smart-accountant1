// Single source of truth for where the desktop app stores local data.
//
// Rule: every silent disk write goes under the OS-standard per-user local
// data directory. On Windows that resolves to:
//   %LOCALAPPDATA%\com.smartaccountant.app\
// which lives outside Program Files and is therefore NEVER touched by the
// NSIS / MSI installer when the user upgrades the .exe.
//
// User-initiated "Save as…" writes (file picker) are not bound by this
// module — those go wherever the user chose.

import { isDesktopRuntime } from "./native-bridge";

function hasTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export interface AppPaths {
  /** Root: %LOCALAPPDATA%\com.smartaccountant.app\ */
  root: string;
  /** Per-company JSON snapshots: <root>/mirror/<companySlug>/{backups,latest}/ */
  mirror: string;
  /** Generic exports (PDF/XLSX/CSV produced from reports): <root>/exports/ */
  exports: string;
  /** App-managed full backups: <root>/backups/ */
  backups: string;
  /** Schema version marker + app state: <root>/state/ */
  state: string;
  /** Migration + diagnostic logs: <root>/logs/ */
  logs: string;
}

let cached: AppPaths | null = null;

/**
 * Resolve the canonical data-root for the current runtime.
 * Returns null in a plain browser tab (no filesystem access).
 */
export async function getAppPaths(): Promise<AppPaths | null> {
  if (cached) return cached;
  if (!isDesktopRuntime()) return null;

  if (hasTauri()) {
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const root = await appLocalDataDir();
    const [mirror, exports_, backups, state, logs] = await Promise.all([
      join(root, "mirror"),
      join(root, "exports"),
      join(root, "backups"),
      join(root, "state"),
      join(root, "logs"),
    ]);
    cached = { root, mirror, exports: exports_, backups, state, logs };
    return cached;
  }

  // Electron bridge: ask the main process for the real, existing data root
  // (it creates the sub-folders on demand) so "open folder" actually works.
  const w = window as unknown as {
    yourMehtaji?: { getDataRoot?: () => Promise<{ ok: boolean; path?: string }> };
  };
  if (w.yourMehtaji?.getDataRoot) {
    try {
      const res = await w.yourMehtaji.getDataRoot();
      if (res?.ok && res.path) {
        const root = res.path.replace(/[\\/]+$/, "");
        const sep = root.includes("\\") ? "\\" : "/";
        cached = {
          root,
          mirror: `${root}${sep}mirror`,
          exports: `${root}${sep}exports`,
          backups: `${root}${sep}backups`,
          state: `${root}${sep}state`,
          logs: `${root}${sep}logs`,
        };
        return cached;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Reset cache (tests). */
export function _resetAppPathsCache(): void {
  cached = null;
}
