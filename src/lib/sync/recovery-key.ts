// Recovery copy of a company key, saved automatically to the user's cloud
// folder (the same account as the backups). Agreed design: no passphrase; the
// user is responsible for protecting that cloud account. The file holds the
// raw company key, so anyone with access to the account can read the books.
//
// Used when all devices and their keychains are lost. It is written once, at
// the start of sync, and never overwritten with a different key.

import type { CloudFolder } from "@/lib/sync/cloud-folder";
import type { KeyStore } from "@/lib/sync/sync-crypto";
import { fromBase64, getOrCreateCompanyKey, toBase64 } from "@/lib/sync/sync-crypto";

const COMPANY_RE = /^[A-Za-z0-9-]{1,64}$/;
const KIND = "smartaccountant-recovery";

export class RecoveryKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryKeyError";
  }
}

export function recoveryFileName(companyId: string): string {
  if (!COMPANY_RE.test(companyId)) throw new RecoveryKeyError("Invalid company id");
  return `recovery-${companyId}.laccrk`;
}

interface RecoveryFile {
  kind: typeof KIND;
  v: 1;
  companyId: string;
  key: string; // base64 of the 32-byte company key
  createdAt: string;
}

export function buildRecoveryText(companyId: string, key: Uint8Array, now = new Date()): string {
  const body: RecoveryFile = {
    kind: KIND,
    v: 1,
    companyId,
    key: toBase64(key),
    createdAt: now.toISOString(),
  };
  return JSON.stringify(body, null, 2);
}

/** Read a recovery file and return the key, after checking it belongs to this company. */
export function parseRecoveryText(text: string, expectedCompanyId: string): Uint8Array {
  let body: Partial<RecoveryFile>;
  try {
    body = JSON.parse(text) as Partial<RecoveryFile>;
  } catch {
    throw new RecoveryKeyError("This is not a recovery file");
  }
  if (body.kind !== KIND || body.v !== 1 || typeof body.key !== "string" || typeof body.companyId !== "string") {
    throw new RecoveryKeyError("This is not a recovery file");
  }
  if (body.companyId !== expectedCompanyId) {
    throw new RecoveryKeyError("This recovery file belongs to a different company");
  }
  const key = fromBase64(body.key);
  if (key.length !== 32) throw new RecoveryKeyError("Recovery file has an invalid key");
  return key;
}

/**
 * Make sure the recovery copy exists in the cloud folder. Creates the company
 * key on this device if none exists yet. Never overwrites an existing file.
 */
export async function ensureRecoveryCopy(
  folder: CloudFolder,
  store: KeyStore,
  companyId: string,
): Promise<{ created: boolean }> {
  const name = recoveryFileName(companyId);
  const existing = await folder.read(name);
  if (existing !== null) {
    // Check it is readable and for this company; do not replace it.
    parseRecoveryText(existing, companyId);
    return { created: false };
  }
  const key = await getOrCreateCompanyKey(store, companyId);
  await folder.writeAtomic(name, buildRecoveryText(companyId, key));
  return { created: true };
}

/** Restore the company key from the cloud folder on a new or rebuilt device. */
export async function restoreKeyFromCloud(
  folder: CloudFolder,
  store: KeyStore,
  companyId: string,
): Promise<void> {
  const text = await folder.read(recoveryFileName(companyId));
  if (text === null) throw new RecoveryKeyError("No recovery file found for this company");
  const key = parseRecoveryText(text, companyId);
  await store.set(companyId, key);
}
