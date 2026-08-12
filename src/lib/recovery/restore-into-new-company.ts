// Recovery utility — restore a backup into a BRAND NEW local company
// instead of overwriting an existing one. Used by the Recovery Wizard when
// the user needs to reconstruct a company from a pre-reinstall backup
// without disturbing the currently active (possibly newer) data.
//
// Contract:
//   - Generates a fresh UUID for the new company.
//   - Optionally overrides the company display name (so users can tell the
//     "Restored" copy apart from the existing one in the switcher).
//   - Reuses the existing `restoreCompanyBackup` pipeline, which already
//     handles ID remapping, ledger/voucher rewrites, and companies.put().
//   - Returns { newCompanyId, summary } for the wizard to link to.

import { parseBackupFile, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";

function newCompanyUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for very old runtimes
  const rand = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-${rand()}-${rand()}${rand()}${rand()}`;
}

export interface RestoreIntoNewResult {
  newCompanyId: string;
  displayName: string;
  vouchers: number;
  ledgers: number;
  items: number;
}

export interface ParsedBackupPreview {
  data: CompanyBackup;
  displayName: string;
  vouchers: number;
  ledgers: number;
  items: number;
  exportedAt: string | null;
  checksumOk: boolean | undefined;
}

/**
 * Parse a backup file's text and return counts + the parsed payload
 * (single-company only — multi-company backups are rejected here because
 * the wizard is scoped to reconstructing one company).
 */
export async function previewBackupForRestore(text: string): Promise<ParsedBackupPreview> {
  const parsed = await parseBackupFile(text);
  if (parsed.kind !== "single") {
    throw new Error(
      "This is a multi-company backup. The Recovery Wizard restores one company at a time — " +
      "please export a single-company backup, or use Backup / Restore to restore each company.",
    );
  }
  const data = parsed.data;
  const c = (data.company ?? {}) as Record<string, unknown>;
  return {
    data,
    displayName: String(c.name ?? "Restored company"),
    vouchers: data.vouchers?.length ?? 0,
    ledgers: data.ledgers?.length ?? 0,
    items: data.items?.length ?? 0,
    exportedAt: (data.exported_at as string | undefined) ?? null,
    checksumOk: parsed.checksumOk,
  };
}

/**
 * Restore a parsed backup into a NEW local company. The new company will
 * appear in the switcher with the provided displayName.
 */
export async function restoreBackupIntoNewCompany(
  backup: CompanyBackup,
  displayName: string,
): Promise<RestoreIntoNewResult> {
  const cleanName = displayName.trim() || "Restored company";
  const newId = newCompanyUuid();

  // Clone shallowly so we don't mutate the caller's object.
  const cloned: CompanyBackup = {
    ...backup,
    company: {
      ...(backup.company ?? {}),
      // Force the mirror to write a fresh row keyed by newId with the
      // user-chosen name. restoreCompanyBackup's mirror always overrides
      // company.id to targetCompanyId, so setting id here is cosmetic —
      // the name is what matters.
      id: newId,
      name: cleanName,
    } as Record<string, unknown>,
  };

  const summary = await restoreCompanyBackup(newId, cloned);

  return {
    newCompanyId: newId,
    displayName: cleanName,
    vouchers: summary.vouchers ?? 0,
    ledgers: summary.ledgers ?? 0,
    items: summary.items ?? 0,
  };
}
