// Unified export saver.
// - In a native desktop runtime (Electron or Tauri) the file is written into
//   the company export folder and a toast offers "Show in folder".
// - In the browser it falls back to a normal Download (saved to the user's
//   Downloads folder).
import { toast } from "sonner";
import {
  isDesktopRuntime,
  saveCompanyFileNative,
  showInFolderNative,
} from "./native-bridge";

export function isDesktop(): boolean {
  return isDesktopRuntime();
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

function browserDownload(
  fileName: string,
  contents: string | ArrayBuffer | Uint8Array,
  mime: string,
): void {
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
    const downloadToastId = toast.success(opts.toastTitle || opts.fileName, {
      description: "Downloaded to your Downloads folder.",
      closeButton: true,
      cancel: {
        label: "Cancel",
        onClick: () => toast.dismiss(downloadToastId),
      },
    });
    return;
  }
  const company = activeCompanyName();
  const res = await b.saveCompanyFile(company, opts.subFolder, opts.fileName, opts.contents);
  if (!res.ok || !res.path) {
    toast.error("Could not save file", {
      description: res.error || "Unknown error",
      closeButton: true,
    });
    return;
  }
  const savedPath = res.path;
  const exportToastId = toast.success(opts.toastTitle || opts.fileName, {
    description: `Saved to ${savedPath}`,
    duration: 10000,
    closeButton: true,
    action: {
      label: "Show in folder",
      onClick: () => {
        void b.showInFolder(savedPath);
      },
    },
    cancel: {
      label: "Cancel",
      onClick: () => toast.dismiss(exportToastId),
    },
  });
}
