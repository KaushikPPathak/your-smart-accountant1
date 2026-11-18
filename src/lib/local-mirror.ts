// Trial-mode "local copy on PC" mirror.
// For companies with mode = 'trial_local', writes JSON only:
//   - <Company>/backups/<Company>_<timestamp>.json   (full restore file)
//   - <Company>/latest/<Company>_latest.json
// In Electron desktop builds the files are written silently to disk.
// In a browser tab the user gets a manual download.

import { buildCompanyBackup } from "./backup";
import { buildBackupWorkbook } from "./backup-excel";
import { wrapBackup } from "./backup-policy";
import { hasNativeStorage, isAndroidRuntime, isDesktopRuntime, saveCompanyFileNative, writeAbsoluteFileNative } from "./native-bridge";
import { getBackupFolder, setBackupFolder } from "./backup-location";
import { getShortDataRoot } from "./short-data-root";

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function browserDownload(fileName: string, contents: string | Uint8Array, mime: string): void {
  let blob: Blob;
  if (typeof contents === "string") {
    blob = new Blob([contents], { type: mime });
  } else {
    const copy = new Uint8Array(contents.byteLength);
    copy.set(contents);
    blob = new Blob([copy.buffer], { type: mime });
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

// ---------- Public API ----------
export interface MirrorResult {
  jsonFile: string;
  desktopJsonPath?: string;
  /** True only on the Windows/Electron desktop app. Android is reported with isAndroid. */
  isDesktop: boolean;
  isAndroid?: boolean;
  /** Excel companion written beside the JSON (file name, saved path on native platforms). */
  excelFile?: string;
  excelPath?: string;
  excelError?: string;
  /** When set, the user-picked folder was unreachable and we fell back to the legacy default location. */
  fallbackReason?: string;
  /** When fallbackReason is set, this is the folder path the user had picked (now unreachable). */
  attemptedFolder?: string;
}

const LAST_MIRROR_KEY = "ym_last_local_mirror:";

export function getLastLocalMirror(companyId: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(LAST_MIRROR_KEY + companyId); } catch { return null; }
}

/**
 * Build a snapshot for the company and write both JSON + XLSX.
 * - Desktop: silently to Documents/YourMehtaji/Exports/<Company>/{backups,latest}/
 * - Browser: triggers two downloads
 */
export async function writeLocalMirror(
  companyId: string,
  companyName: string,
  partyCode?: string | null,
): Promise<MirrorResult> {
  const backup = await buildCompanyBackup(companyId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safe = safeName(companyName);
  // Embed party code (GSTIN/PAN) into filename so backups are easy to recognise
  // on the hard disk even when the company is renamed later.
  const codePart = partyCode ? `_${safeName(partyCode)}` : "";
  const jsonFile = `${safe}${codePart}_${stamp}.json`;
  const latestJson = `${safe}${codePart}_latest.json`;

  // Wrap in the signed envelope so the JSON file carries a SHA-256 checksum
  // and is recognised by parseBackupFile as a trustworthy restore source.
  // Prior versions wrote raw JSON, which meant silent corruption / truncation
  // was undetectable. parseBackupFile still accepts legacy bare files, so
  // old mirror artifacts continue to restore without any user action.
  const envelope = await wrapBackup(backup);
  const jsonStr = JSON.stringify(envelope);

  // Readable Excel companion. A failure here must not block the JSON safety copy.
  const xlsxName = `${safe}${codePart}_${stamp}.xlsx`;
  let xlsxBytes: Uint8Array | null = null;
  let excelError: string | undefined;
  try {
    xlsxBytes = new Uint8Array(await buildBackupWorkbook(backup));
  } catch (e) {
    excelError = e instanceof Error ? e.message : String(e);
  }

  if (hasNativeStorage()) {
    // If the user hasn't picked a backup folder yet, default to the short
    // data root (C:\smartaccountant on Windows, ~/smartaccountant elsewhere)
    // — the same easy-to-find root used for report exports. This is
    // remembered so the Backup & Restore UI shows the location clearly.
    let chosen = getBackupFolder(companyId);
    if (!chosen) {
      const shortRoot = await getShortDataRoot();
      if (shortRoot) {
        chosen = shortRoot;
        setBackupFolder(companyId, shortRoot);
      }
    }
    const companySeg = safeName(companyName);
    let j1, j2;
    let fallbackReason: string | undefined;
    let attemptedFolder: string | undefined;
    // Folder the JSON was written to; null means the company's default folder.
    let jsonDir: string | null = null;
    if (chosen) {
      // Write into the user-picked folder: <chosen>/<Company>/backups + /latest
      const base = `${chosen.replace(/[\\/]+$/, "")}/${companySeg}`;
      jsonDir = base;
      [j1, j2] = await Promise.all([
        writeAbsoluteFileNative(base, "backups", jsonFile, jsonStr),
        writeAbsoluteFileNative(base, "latest", latestJson, jsonStr),
      ]);
      // If the chosen folder is unreachable (drive missing, path deleted, permissions),
      // fall back to the short data root, update the stored setting so future
      // backups don't keep tripping the missing drive, and surface a warning.
      if (!j1.ok || !j2.ok) {
        fallbackReason = j1.error || j2.error || "Unknown error";
        attemptedFolder = chosen;
        const shortRoot = await getShortDataRoot();
        if (shortRoot && shortRoot !== chosen) {
          const base2 = `${shortRoot.replace(/[\\/]+$/, "")}/${companySeg}`;
          jsonDir = base2;
          [j1, j2] = await Promise.all([
            writeAbsoluteFileNative(base2, "backups", jsonFile, jsonStr),
            writeAbsoluteFileNative(base2, "latest", latestJson, jsonStr),
          ]);
          if (j1.ok && j2.ok) setBackupFolder(companyId, shortRoot);
        }
        if (!j1.ok || !j2.ok) {
          [j1, j2] = await Promise.all([
            saveCompanyFileNative(companyName, "backups", jsonFile, jsonStr),
            saveCompanyFileNative(companyName, "latest", latestJson, jsonStr),
          ]);
        }
      }
    } else {
      // Last-resort fallback: legacy %LOCALAPPDATA%\...\mirror\<Company>\... location.
      jsonDir = null;
      [j1, j2] = await Promise.all([
        saveCompanyFileNative(companyName, "backups", jsonFile, jsonStr),
        saveCompanyFileNative(companyName, "latest", latestJson, jsonStr),
      ]);
    }
    if (!j1.ok || !j2.ok) {
      const err = j1.error || j2.error || "Unknown error";
      throw new Error(`Local save failed: ${err}`);
    }
    let excelPath: string | undefined;
    if (xlsxBytes) {
      const xr = jsonDir
        ? await writeAbsoluteFileNative(jsonDir, "backups", xlsxName, xlsxBytes)
        : await saveCompanyFileNative(companyName, "backups", xlsxName, xlsxBytes);
      if (xr.ok) excelPath = xr.path;
      else excelError = xr.error || "Excel save failed";
    }
    try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
    return {
      jsonFile,
      desktopJsonPath: j1.path,
      isDesktop: isDesktopRuntime(),
      isAndroid: isAndroidRuntime(),
      excelFile: xlsxBytes ? xlsxName : undefined,
      excelPath,
      excelError,
      fallbackReason,
      attemptedFolder,
    };
  }

  // Browser fallback — single JSON download.
  browserDownload(jsonFile, jsonStr, "application/json");
  if (xlsxBytes) {
    browserDownload(xlsxName, xlsxBytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
  return { jsonFile, isDesktop: false, isAndroid: false, excelFile: xlsxBytes ? xlsxName : undefined, excelError };
}
