// OneDrive sign-in for sync, built on the existing PKCE flow in
// cloud-providers.ts. This module only supplies the app's client id and
// exposes a token provider for cloud-folder.ts.

import {
  connectProvider,
  getClientId,
  getFreshAccessToken,
  isConnected,
  setStoredClientId,
} from "@/lib/cloud-providers";
import { ONEDRIVE_CLIENT_ID } from "@/lib/sync/onedrive-config";

/** Make sure the OneDrive client id is set before sign-in. Keeps any id the user already stored. */
export function ensureOneDriveClientId(): string {
  const existing = getClientId("onedrive");
  if (existing) return existing;
  setStoredClientId("onedrive", ONEDRIVE_CLIENT_ID);
  return ONEDRIVE_CLIENT_ID;
}

export function isOneDriveSignedIn(): boolean {
  return isConnected("onedrive");
}

/** Opens the Microsoft sign-in window. Must be called from a user click. */
export async function connectOneDrive(): Promise<void> {
  ensureOneDriveClientId();
  await connectProvider("onedrive");
}

/** Access token for cloud-folder.ts. Refreshes the token when it is near expiry. */
export function oneDriveTokenProvider(): () => Promise<string> {
  return () => getFreshAccessToken("onedrive");
}
