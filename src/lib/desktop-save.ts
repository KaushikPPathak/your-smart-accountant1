// Unified export saver.
// - In the Electron desktop app: writes to
//     %USERPROFILE%/Documents/YourMehtaji/Exports/<Company>/<subFolder>/<fileName>
//   then auto-opens the file in the OS default viewer and shows a toast with
//   a "Show in folder" action.
// - In the browser: falls back to a normal "Download" (saved to the user's
//   Downloads folder, same behaviour as before).
import { toast } from "sonner";

interface DesktopBridge {
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

function bridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { yourMehtaji?: DesktopBridge };
  return w.yourMehtaji?.isDesktop ? w.yourMehtaji : null;
}

export function isDesktop(): boolean {
  return bridge() !== null;
}

const COMPANY_NAME_KEY = "ym_active_company_name";

export function rememberActiveCompanyName(name: string | null | undefined): void {
  if (typeof window === "undefined") return;
  if (name && name.trim()) localStorage.setItem(COMPANY_NAME_KEY, name.trim());
}

function activeCompanyName(): string {
  if (typeof window === "undefined") return "Default";
  return localStorage.getItem(COMPANY_NAME_KEY) || "Default";
}

function browserDownload(fileName: string, contents: string | ArrayBuffer | Uint8Array, mime: string): void {
  let blob: Blob;
  if (typeof contents === "string") {
    blob = new Blob([contents], { type: mime });
  } else if (contents instanceof Uint8Array) {
    // Copy into a fresh ArrayBuffer to satisfy strict BlobPart typing.
    const copy = new Uint8Array(contents.byteLength);
    copy.set(contents);
    blob = new Blob([copy.buffer], { type: mime });
  } else {
    blob = new Blob([contents], { type: mime });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveExportOptions {
  /** Sub-folder inside the company export folder, e.g. "Reports", "Invoices", "GST". */
  subFolder: string;
  fileName: string;
  contents: string | ArrayBuffer | Uint8Array;
  /** MIME type used for the browser download fallback. */
  mime: string;
  /** Optional toast title. Defaults to fileName. */
  toastTitle?: string;
}

/**
 * Save an export. In desktop mode the file is written to the company folder
 * automatically and opened in the default viewer; a toast offers "Show in folder".
 * In browser mode it triggers a normal download.
 */
export async function saveExport(opts: SaveExportOptions): Promise<void> {
  const b = bridge();
  if (!b) {
    browserDownload(opts.fileName, opts.contents, opts.mime);
    toast.success(opts.toastTitle || opts.fileName, {
      description: "Downloaded to your Downloads folder.",
      closeButton: true,
    });
    return;
  }
  const company = activeCompanyName();
  const res = await b.saveCompanyFile(company, opts.subFolder, opts.fileName, opts.contents);
  if (!res.ok || !res.path) {
    toast.error("Could not save file", { description: res.error || "Unknown error", closeButton: true });
    return;
  }
  const savedPath = res.path;
  toast.success(opts.toastTitle || opts.fileName, {
    description: `Saved to ${savedPath}`,
    duration: 10000,
    closeButton: true,
    action: {
      label: "Show in folder",
      onClick: () => { void b.showInFolder(savedPath); },
    },
  });
}
