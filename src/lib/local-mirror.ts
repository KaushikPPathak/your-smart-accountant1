// Trial-mode "local copy on PC" mirror.
// For companies with mode = 'trial_local', writes JSON only:
//   - <Company>/backups/<Company>_<timestamp>.json   (full restore file)
//   - <Company>/latest/<Company>_latest.json
// In Electron desktop builds the files are written silently to disk.
// In a browser tab the user gets a manual download.

import { buildCompanyBackup } from "./backup";
import { isDesktopRuntime, saveCompanyFileNative, writeAbsoluteFileNative } from "./native-bridge";
import { getBackupFolder } from "./backup-location";

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
  isDesktop: boolean;
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

  const jsonStr = JSON.stringify(backup, null, 2);

  if (isDesktopRuntime()) {
    const chosen = getBackupFolder(companyId);
    const companySeg = safeName(companyName);
    let j1, j2;
    if (chosen) {
      // Write into the user-picked folder: <chosen>/<Company>/backups + /latest
      const base = `${chosen.replace(/[\\/]+$/, "")}/${companySeg}`;
      [j1, j2] = await Promise.all([
        writeAbsoluteFileNative(base, "backups", jsonFile, jsonStr),
        writeAbsoluteFileNative(base, "latest", latestJson, jsonStr),
      ]);
    } else {
      // Fallback: legacy %LOCALAPPDATA%\...\mirror\<Company>\... location.
      [j1, j2] = await Promise.all([
        saveCompanyFileNative(companyName, "backups", jsonFile, jsonStr),
        saveCompanyFileNative(companyName, "latest", latestJson, jsonStr),
      ]);
    }
    if (!j1.ok || !j2.ok) {
      const err = j1.error || j2.error || "Unknown error";
      throw new Error(`Local save failed: ${err}`);
    }
    try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
    return {
      jsonFile,
      desktopJsonPath: j1.path,
      isDesktop: true,
    };
  }

  // Browser fallback — single JSON download.
  browserDownload(jsonFile, jsonStr, "application/json");
  try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
  return { jsonFile, isDesktop: false };
}
