// User-owned cloud backup helpers.
//
// Step 3 of the local-first data ownership model: give the user one-click
// ways to back their business data up to storage THEY control.
//
// Phase 3a (this file): manual .laccbak file — a portable, self-contained
// snapshot the user can hand-copy anywhere (USB drive, email attachment,
// their own Google Drive folder, etc.). This reuses the existing
// signed-envelope backup format under a friendlier extension so users can
// recognise it at a glance and file-manager double-click can be wired to
// the app later.
//
// Phase 3b (planned): direct one-click push to Google Drive / OneDrive /
// Dropbox using the user's own account. UI hooks for those live in
// CloudBackupCard.tsx and currently show "coming soon" — never our
// servers, always the user's own cloud.

import { buildCompanyBackup, type CompanyBackup, type MultiCompanyBackup, type SaveResult } from "@/lib/backup";
import { wrapBackup } from "@/lib/backup-policy";
import { isDesktopRuntime, saveCompanyFileNative, writeAbsoluteFileNative } from "@/lib/native-bridge";
import { getBackupFolder } from "@/lib/backup-location";

export const LACCBAK_EXT = "laccbak";
export const LACCBAK_MIME = "application/octet-stream";

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function browserDownload(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: LACCBAK_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCompanyLaccbak(
  companyId: string,
  companyName: string,
): Promise<SaveResult> {
  const payload = await buildCompanyBackup(companyId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${safeName(companyName)}_${stamp}.${LACCBAK_EXT}`;
  const envelope = await wrapBackup(payload);
  const contents = JSON.stringify(envelope);

  if (isDesktopRuntime()) {
    const chosen = getBackupFolder(companyId);
    const res = chosen
      ? await writeAbsoluteFileNative(
          `${chosen.replace(/[\\/]+$/, "")}/${safeName(companyName)}`,
          "cloud-backups",
          fileName,
          contents,
        )
      : await saveCompanyFileNative(companyName, "cloud-backups", fileName, contents);
    if (res.ok) return { fileName, desktopPath: res.path };
  }
  browserDownload(fileName, contents);
  return { fileName };
}

export async function exportAllCompaniesLaccbak(
  companies: { id: string; name: string }[],
): Promise<SaveResult> {
  const all: CompanyBackup[] = [];
  for (const c of companies) all.push(await buildCompanyBackup(c.id));
  const payload: MultiCompanyBackup = {
    schema_version: 1,
    kind: "all_companies",
    exported_at: new Date().toISOString(),
    companies: all,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `YourMehtaji_AllCompanies_${stamp}.${LACCBAK_EXT}`;
  const envelope = await wrapBackup(payload);
  const contents = JSON.stringify(envelope);

  if (isDesktopRuntime()) {
    const res = await saveCompanyFileNative("_AllCompanies", "cloud-backups", fileName, contents);
    if (res.ok) return { fileName, desktopPath: res.path };
  }
  browserDownload(fileName, contents);
  return { fileName };
}

// Last-backup bookkeeping so the UI can nag users who haven't backed up recently.
const LAST_KEY = "ym_last_user_cloud_backup";

export function markUserCloudBackupNow(): void {
  try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch { /* ignore */ }
}
export function getLastUserCloudBackup(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
