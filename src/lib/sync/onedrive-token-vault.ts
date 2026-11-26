// Keeps the OneDrive token encrypted at rest.
//
// The token is encrypted with AES-256-GCM using a key kept in the OS keychain
// (see keychain-store.ts). Local storage holds only the ciphertext. The plain
// token exists in local storage only briefly, while cloud-providers.ts is
// refreshing it; it is encrypted and removed straight after.

import type { KeyStore } from "@/lib/sync/sync-crypto";
import {
  decryptPacket,
  encryptPacket,
  getOrCreateCompanyKey,
  packetAad,
  packetFromText,
  packetToText,
} from "@/lib/sync/sync-crypto";

export interface VaultToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  account_label?: string;
}

const VAULT_KEY = "ym_sync_onedrive_vault";
const VAULT_CONTEXT = "onedrive-token-vault";
const AAD = packetAad({ companyId: VAULT_CONTEXT, kind: "token", sequence: 0 });

export function hasVaultedToken(): boolean {
  try {
    return localStorage.getItem(VAULT_KEY) !== null;
  } catch {
    return false;
  }
}

export async function saveVaultedToken(store: KeyStore, tok: VaultToken): Promise<void> {
  const key = await getOrCreateCompanyKey(store, VAULT_CONTEXT);
  const packet = await encryptPacket(key, new TextEncoder().encode(JSON.stringify(tok)), AAD);
  localStorage.setItem(VAULT_KEY, packetToText(packet));
}

export async function loadVaultedToken(store: KeyStore): Promise<VaultToken | null> {
  const text = localStorage.getItem(VAULT_KEY);
  if (text === null) return null;
  const key = await store.get(VAULT_CONTEXT);
  if (!key) throw new Error("Encryption key for the OneDrive token is missing on this device");
  const pt = await decryptPacket(key, packetFromText(text), AAD);
  return JSON.parse(new TextDecoder().decode(pt)) as VaultToken;
}

export function clearVaultedToken(): void {
  try {
    localStorage.removeItem(VAULT_KEY);
  } catch {
    /* ignore */
  }
}
