// Per-company backup folder (chosen by the user via a native folder picker).
// Stored in localStorage so each company can point at a different folder
// (e.g. company A -> D:\Accounts\Acme, company B -> a OneDrive folder).
//
// A global default key is used as a fallback when a company hasn't picked one
// yet — so once the user picks a folder for the first company, every other
// company suggests the same one.

const KEY_PREFIX = "ym_backup_folder:";
const DEFAULT_KEY = `${KEY_PREFIX}_default`;

export function getBackupFolder(companyId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      localStorage.getItem(KEY_PREFIX + companyId) ||
      localStorage.getItem(DEFAULT_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

export function setBackupFolder(companyId: string, path: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_PREFIX + companyId, path);
    // Also set as the global default for newly-created companies.
    localStorage.setItem(DEFAULT_KEY, path);
  } catch {
    /* ignore */
  }
}

export function clearBackupFolder(companyId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY_PREFIX + companyId);
  } catch {
    /* ignore */
  }
}
