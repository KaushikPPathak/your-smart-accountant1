// Unified native runtime bridge for Electron + Tauri.
//
// The app historically shipped as an Electron desktop build that exposed an
// IPC bridge on `window.yourMehtaji`. We're now also targeting Tauri, which
// surfaces `window.__TAURI__` and uses `@tauri-apps/api` + plugins for
// filesystem / shell access.
//
// All file-saving / "show in folder" / "open path" callers should go through
// this module instead of poking at `window.yourMehtaji` directly. Browser
// callers keep their existing download-fallback behaviour.

export type NativeRuntime = "electron" | "tauri" | "browser";

interface ElectronBridge {
  isDesktop: true;
  saveCompanyFile: (
    company: string,
    subFolder: string,
    fileName: string,
    contents: string | ArrayBuffer | Uint8Array,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  showInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  openPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  closeApp?: () => Promise<{ ok: boolean; error?: string }>;
}

function electronBridge(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { yourMehtaji?: ElectronBridge };
  return w.yourMehtaji?.isDesktop ? w.yourMehtaji : null;
}

function hasTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export function getNativeRuntime(): NativeRuntime {
  if (electronBridge()) return "electron";
  if (hasTauri()) return "tauri";
  return "browser";
}

export function isDesktopRuntime(): boolean {
  return getNativeRuntime() !== "browser";
}

function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-. ]+/g, "_").slice(0, 80) || "Default";
}

export interface SaveNativeResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Save a file to the platform-native company export folder.
 * - Electron: routes through the preload IPC bridge.
 * - Tauri:   writes under appDataDir/Exports/<company>/<subFolder>/<fileName>.
 * - Browser: returns ok=false; callers should fall back to a download.
 */
export async function saveCompanyFileNative(
  company: string,
  subFolder: string,
  fileName: string,
  contents: string | ArrayBuffer | Uint8Array,
): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb) {
    return eb.saveCompanyFile(company, subFolder, fileName, contents);
  }
  if (hasTauri()) {
    try {
      const [{ appDataDir, join }, fs] = await Promise.all([
        import("@tauri-apps/api/path"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const base = await appDataDir();
      const dir = await join(base, "Exports", safeSeg(company), safeSeg(subFolder));
      await fs.mkdir(dir, { recursive: true });
      const fullPath = await join(dir, fileName);
      if (typeof contents === "string") {
        await fs.writeTextFile(fullPath, contents);
      } else {
        const bytes =
          contents instanceof Uint8Array ? contents : new Uint8Array(contents as ArrayBuffer);
        await fs.writeFile(fullPath, bytes);
      }
      return { ok: true, path: fullPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "No native runtime" };
}

export async function showInFolderNative(filePath: string): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb) return eb.showInFolder(filePath);
  if (hasTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      // No dedicated "reveal" API in plugin-shell — open the parent directory.
      const parent = filePath.replace(/[\\/][^\\/]*$/, "");
      await open(parent || filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "No native runtime" };
}

export async function openPathNative(filePath: string): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb) return eb.openPath(filePath);
  if (hasTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "No native runtime" };
}

export async function closeNativeApp(): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb?.closeApp) return eb.closeApp();
  if (hasTauri()) {
    try {
      const w = window as unknown as {
        __TAURI__?: {
          window?: { getCurrentWindow?: () => { destroy?: () => Promise<void>; close?: () => Promise<void> } };
          process?: { exit?: (code?: number) => Promise<void> };
        };
      };
      // Prefer the injected global (works when the frontend is loaded from a remote URL
      // because dynamic `import("@tauri-apps/api/window")` may not be reachable there).
      const getCurr = w.__TAURI__?.window?.getCurrentWindow;
      if (typeof getCurr === "function") {
        const win = getCurr();
        if (win?.destroy) { await win.destroy(); return { ok: true }; }
        if (win?.close)   { await win.close();   return { ok: true }; }
      }
      if (w.__TAURI__?.process?.exit) {
        await w.__TAURI__.process.exit(0);
        return { ok: true };
      }
      // Fallback: dynamic import (works in bundled local builds).
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      if (typeof currentWindow.destroy === "function") {
        await currentWindow.destroy();
      } else {
        await currentWindow.close();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "No native runtime" };
}

/**
 * Show a native "Save as…" dialog and write the given contents to the chosen path.
 * Tauri only. Returns { ok: false } in Electron / browser so callers can fall back.
 */
export async function saveWithPickerNative(
  defaultFileName: string,
  contents: string | ArrayBuffer | Uint8Array,
  filters?: { name: string; extensions: string[] }[],
): Promise<SaveNativeResult> {
  if (!hasTauri()) return { ok: false, error: "No Tauri runtime" };
  try {
    const w = window as unknown as {
      __TAURI__?: {
        dialog?: { save?: (opts: unknown) => Promise<string | null> };
        fs?: {
          writeTextFile?: (p: string, c: string) => Promise<void>;
          writeFile?: (p: string, c: Uint8Array) => Promise<void>;
        };
      };
    };
    let chosen: string | null = null;
    if (w.__TAURI__?.dialog?.save) {
      chosen = await w.__TAURI__.dialog.save({ defaultPath: defaultFileName, filters });
    } else {
      const dlg = await import("@tauri-apps/plugin-dialog");
      chosen = await dlg.save({ defaultPath: defaultFileName, filters });
    }
    if (!chosen) return { ok: false, error: "cancelled" };
    if (w.__TAURI__?.fs?.writeTextFile && typeof contents === "string") {
      await w.__TAURI__.fs.writeTextFile(chosen, contents);
    } else {
      const fs = await import("@tauri-apps/plugin-fs");
      if (typeof contents === "string") {
        await fs.writeTextFile(chosen, contents);
      } else {
        const bytes =
          contents instanceof Uint8Array ? contents : new Uint8Array(contents as ArrayBuffer);
        await fs.writeFile(chosen, bytes);
      }
    }
    return { ok: true, path: chosen };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

