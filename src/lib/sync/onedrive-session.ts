// OneDrive sign-in for sync, built on the existing PKCE flow in
// cloud-providers.ts. The token is moved into an encrypted vault right after
// sign-in and after every refresh, so it does not stay in plain local storage.

import {
  clearToken,
  connectProvider,
  getClientId,
  getFreshAccessToken,
  loadToken,
  saveToken,
  setStoredClientId,
} from "@/lib/cloud-providers";
import type { KeyStore } from "@/lib/sync/sync-crypto";
import { ONEDRIVE_CLIENT_ID } from "@/lib/sync/onedrive-config";
import {
  clearVaultedToken,
  hasVaultedToken,
  loadVaultedToken,
  saveVaultedToken,
  type VaultToken,
} from "@/lib/sync/onedrive-token-vault";

/** Make sure the OneDrive client id is set before sign-in. Keeps any id the user already stored. */
export function ensureOneDriveClientId(): string {
  const existing = getClientId("onedrive");
  if (existing) return existing;
  setStoredClientId("onedrive", ONEDRIVE_CLIENT_ID);
  return ONEDRIVE_CLIENT_ID;
}

export function isOneDriveSignedIn(): boolean {
  return hasVaultedToken();
}

/** Move the plain token written by cloud-providers into the encrypted vault. */
async function vaultFromPlain(store: KeyStore): Promise<void> {
  const plain = loadToken("onedrive");
  if (!plain) return;
  await saveVaultedToken(store, plain as VaultToken);
  clearToken("onedrive");
}

/** Opens the Microsoft sign-in window. Must be called from a user click. */
export async function connectOneDrive(store: KeyStore): Promise<void> {
  ensureOneDriveClientId();
  await connectProvider("onedrive");
  await vaultFromPlain(store);
}

/** Access token for cloud-folder.ts. Refreshes via cloud-providers when near expiry, then re-vaults. */
export function oneDriveTokenProvider(store: KeyStore): () => Promise<string> {
  return async () => {
    const vaulted = await loadVaultedToken(store);
    if (!vaulted) throw new Error("Not connected to OneDrive.");
    if (vaulted.expires_at > Date.now() + 5000) return vaulted.access_token;
    // Let cloud-providers refresh the token: put it back for the duration of the call.
    saveToken("onedrive", vaulted);
    try {
      const fresh = await getFreshAccessToken("onedrive");
      return fresh;
    } finally {
      await vaultFromPlain(store);
    }
  };
}

export function disconnectOneDrive(): void {
  clearVaultedToken();
  clearToken("onedrive");
}
