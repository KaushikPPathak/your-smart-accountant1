// Unified export saver.
// - In a native desktop runtime (Electron or Tauri) the file is written into
//   the company export folder and a toast offers "Show in folder".
// - In the browser it falls back to a normal Download (saved to the user's
//   Downloads folder).
import { toast } from "sonner";
import {
  hasNativeStorage,
  isAndroidTauri,
  openFileAndroid,
  saveCompanyFileNative,
  saveToDownloadsAndroid,
  shareFilesAndroid,
  showInFolderNative,
  openPathNative,
} from "./native-bridge";

export function isDesktop(): boolean {
  return hasNativeStorage();
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
export async function saveExport(opts: SaveExportOptions): Promise<string | null> {
  if (!hasNativeStorage()) {
    browserDownload(opts.fileName, opts.contents, opts.mime);
    const downloadToastId = toast.success(opts.toastTitle || opts.fileName, {
      description: "Downloaded to your Downloads folder.",
      closeButton: true,
      cancel: {
        label: "Cancel",
        onClick: () => toast.dismiss(downloadToastId),
      },
    });
    return null;
  }
  const company = activeCompanyName();
  const res = await saveCompanyFileNative(company, opts.subFolder, opts.fileName, opts.contents);
  if (!res.ok || !res.path) {
    toast.error("Could not save file", {
      description: res.error || "Unknown error",
      closeButton: true,
    });
    return null;
  }
  const savedPath = res.path;
  if (isAndroidTauri()) {
    return announceAndroidExport(opts, company, savedPath);
  }
  // Compact description: show only the parent folder name, not the full path.
  const folderName = savedPath.replace(/[\\/][^\\/]+$/, "").replace(/^.*[\\/]/, "") || "folder";
  const exportToastId = toast.success(opts.toastTitle || opts.fileName, {
    description: `Saved to …\\${folderName}`,
    duration: 6000,
    closeButton: true,
    className: "sa-compact-toast",
    action: {
      label: "Open Location",
      onClick: () => {
        void showInFolderNative(savedPath);
      },
    },
    cancel: {
      label: "Open File",
      onClick: () => {
        void openPathNative(savedPath);
      },
    },
  });
  return savedPath;
}

function androidMime(fileName: string, fallback: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".json")) return "application/json";
  return fallback;
}

/**
 * Android: the file is copied to the public Downloads folder (so it can be
 * found in the Files app) and the toast offers Open (viewer, Back returns here)
 * and Share (Drive, email, WhatsApp...). Nothing leaves the app until the user taps.
 */
async function announceAndroidExport(
  opts: SaveExportOptions,
  company: string,
  appPath: string,
): Promise<string> {
  const mime = androidMime(opts.fileName, opts.mime);
  const safeCompany = company.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Company";
  const dl = await saveToDownloadsAndroid({
    filePath: appPath,
    fileName: opts.fileName,
    mime,
    folder: `Your Mehtaji/${safeCompany}/${opts.subFolder}`,
  });
  const where = dl.ok && dl.displayPath
    ? `Saved to ${dl.displayPath} — find it in the Files app.`
    : `Saved in the app. Downloads copy failed: ${dl.error ?? "unknown error"}`;
  toast.success(opts.toastTitle || opts.fileName, {
    description: `${where} Tap Open to view it or Share to send it; Back returns here.`,
    duration: 30000,
    closeButton: true,
    action: {
      label: "Open",
      onClick: () => {
        void openFileAndroid({ title: opts.fileName, filePath: appPath, fileName: opts.fileName, mime }).then((r) => {
          if (!r.ok) toast.error("Could not open the file", { description: r.error });
        });
      },
    },
    cancel: {
      label: "Share",
      onClick: () => {
        void shareFilesAndroid({ title: opts.fileName, paths: [appPath], names: [opts.fileName] }).then((r) => {
          if (!r.ok) toast.error("Could not share the file", { description: r.error });
        });
      },
    },
  });
  return dl.ok && dl.displayPath ? dl.displayPath : appPath;
}
