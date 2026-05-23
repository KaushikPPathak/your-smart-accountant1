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
}

function electronBridge(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { yourMehtaji?: ElectronBridge };
  return w.yourMehtaji?.isDesktop ? w.yourMehtaji : null;
}

function hasTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
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
      const { revealItemInDir } = await import("@tauri-apps/plugin-shell");
      await revealItemInDir(filePath);
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
