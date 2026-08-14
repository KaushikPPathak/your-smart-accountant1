// Unified native runtime bridge for Electron + Tauri + Web Browser.
//
// All file-saving / "show in folder" / "open path" / WhatsApp integration callers 
// should go through this module instead of poking at global window variables directly.

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
  getDataRoot?: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  pickFolder?: (defaultPath?: string) => Promise<SaveNativeResult>;
  pickFile?: (
    defaultPath?: string,
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<SaveNativeResult>;
  saveWithPicker?: (
    defaultFileName: string,
    contents: string | ArrayBuffer | Uint8Array,
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<SaveNativeResult>;
  readTextFile?: (absPath: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  writeAbsoluteFile?: (
    absDir: string,
    subFolder: string,
    fileName: string,
    contents: string | ArrayBuffer | Uint8Array,
  ) => Promise<SaveNativeResult>;
  readDir?: (absPath: string) => Promise<{ ok: boolean; entries?: string[]; error?: string }>;
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

function safeFileName(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "file";
}

export interface SaveNativeResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Clean phone numbers to standard format (digits only).
 * Prepends '91' for standard 10-digit Indian numbers.
 */
export function sanitizePhoneNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

/**
 * High-speed WhatsApp opener:
 * 1. Handoff via OS shell (`@tauri-apps/plugin-shell`) if running in Tauri.
 * 2. DOM anchor link dispatch for native URI scheme (`whatsapp://`).
 * 3. Browser fallback.
 */
export async function openWhatsAppChatNative(phone: string, message: string): Promise<SaveNativeResult> {
  const sanitizedPhone = sanitizePhoneNumber(phone);
  const encodedText = encodeURIComponent(message);

  const nativeAppUri = sanitizedPhone
    ? `whatsapp://send?phone=${sanitizedPhone}&text=${encodedText}`
    : `whatsapp://`;

  const webUrl = sanitizedPhone
    ? `https://web.whatsapp.com/send?phone=${sanitizedPhone}&text=${encodedText}`
    : `https://web.whatsapp.com`;

  // 1. Tauri Runtime Handoff via Shell
  if (hasTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(nativeAppUri);
      return { ok: true };
    } catch {
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(webUrl);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // 2. DOM Trigger for Web / Electron
  if (typeof window !== "undefined") {
    const link = document.createElement("a");
    link.href = nativeAppUri;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
    }, 500);

    return { ok: true };
  }

  return { ok: false, error: "Failed to open WhatsApp target" };
}

/**
 * Save a file to the platform-native company export folder.
 */
export async function saveCompanyFileNative(
  company: string,
  subFolder: string,
  fileName: string,
  contents: string | ArrayBuffer | Uint8Array,
): Promise<SaveNativeResult> {
  const cleanName = safeFileName(fileName);
  const eb = electronBridge();
  if (eb) {
    return eb.saveCompanyFile(company, subFolder, cleanName, contents);
  }
  if (hasTauri()) {
    try {
      const [{ appLocalDataDir, join }, fs, { getShortDataRoot }] = await Promise.all([
        import("@tauri-apps/api/path"),
        import("@tauri-apps/plugin-fs"),
        import("./short-data-root"),
      ]);
      let base = await getShortDataRoot();
      if (!base) {
        const appBase = await appLocalDataDir();
        base = await join(appBase, "mirror");
      }
      const dir = await join(base, safeSeg(company), safeSeg(subFolder));
      await fs.mkdir(dir, { recursive: true });
      const fullPath = await join(dir, safeFileName(fileName));
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

export const NO_NATIVE_PICKER = "NO_NATIVE_PICKER";

function downloadInBrowser(fileName: string, contents: string | ArrayBuffer | Uint8Array): SaveNativeResult {
  try {
    if (typeof document === "undefined") return { ok: false, error: NO_NATIVE_PICKER };
    const blobPart: BlobPart =
      typeof contents === "string"
        ? contents
        : contents instanceof Uint8Array
          ? new Uint8Array(contents).buffer
          : (contents as ArrayBuffer);
    const bytes = new Blob([blobPart], {
      type: typeof contents === "string" ? "application/json;charset=utf-8" : "application/octet-stream",
    });

    const url = URL.createObjectURL(bytes);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, path: "Downloads folder" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveWithPickerNative(
  defaultFileName: string,
  contents: string | ArrayBuffer | Uint8Array,
  filters?: { name: string; extensions: string[] }[],
): Promise<SaveNativeResult> {
  const eb0 = electronBridge();
  if (eb0?.saveWithPicker) return eb0.saveWithPicker(defaultFileName, contents, filters);
  if (!hasTauri()) {
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> };
    if (typeof w.showSaveFilePicker === "function") {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: safeFileName(defaultFileName),
          types: (filters ?? []).map((f) => ({
            description: f.name,
            accept: { "application/octet-stream": f.extensions.map((e) => `.${e}`) },
          })),
        });
        const writable = await handle.createWritable();
        await writable.write(
          typeof contents === "string"
            ? contents
            : contents instanceof Uint8Array
              ? contents
              : new Uint8Array(contents as ArrayBuffer),
        );
        await writable.close();
        return { ok: true, path: handle.name ?? defaultFileName };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/abort/i.test(msg)) return { ok: false, error: "cancelled" };
      }
    }
    return downloadInBrowser(defaultFileName, contents);
  }

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

export async function pickFolderNative(defaultPath?: string): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb?.pickFolder) return eb.pickFolder(defaultPath);
  if (!hasTauri()) return { ok: false, error: NO_NATIVE_PICKER };
  try {
    const dlg = await import("@tauri-apps/plugin-dialog");
    const chosen = await dlg.open({ directory: true, multiple: false, defaultPath });
    if (!chosen || Array.isArray(chosen)) return { ok: false, error: "cancelled" };
    return { ok: true, path: chosen };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pickFileNative(
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb?.pickFile) return eb.pickFile(defaultPath, filters);
  if (!hasTauri()) return { ok: false, error: NO_NATIVE_PICKER };
  try {
    const dlg = await import("@tauri-apps/plugin-dialog");
    const chosen = await dlg.open({ directory: false, multiple: false, defaultPath, filters });
    if (!chosen || Array.isArray(chosen)) return { ok: false, error: "cancelled" };
    return { ok: true, path: chosen };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readAbsoluteTextFileNative(absPath: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const eb = electronBridge();
  if (eb?.readTextFile) return eb.readTextFile(absPath);
  if (!hasTauri()) return { ok: false, error: "This build cannot read files directly — use the file chooser instead." };
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const text = await fs.readTextFile(absPath);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function writeAbsoluteFileNative(
  absDir: string,
  subFolder: string,
  fileName: string,
  contents: string | ArrayBuffer | Uint8Array,
): Promise<SaveNativeResult> {
  const eb = electronBridge();
  if (eb?.writeAbsoluteFile) return eb.writeAbsoluteFile(absDir, subFolder, fileName, contents);
  if (!hasTauri()) return { ok: false, error: NO_NATIVE_PICKER };
  try {
    const [{ join }, fs] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const segments = subFolder
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .map(safeSeg);
    const dir = segments.length ? await join(absDir, ...segments) : absDir;
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
