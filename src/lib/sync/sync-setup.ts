// Turning sync on and pairing a phone. Logic only; the screen calls these.

import { createOneDriveFolder, type CloudFolder } from "@/lib/sync/cloud-folder";
import { generateDeviceId, createPairingOffer, type PairingOffer } from "@/lib/sync/pairing";
import { ensureRecoveryCopy } from "@/lib/sync/recovery-key";
import type { KeyStore } from "@/lib/sync/sync-crypto";
import { getOrCreateCompanyKey } from "@/lib/sync/sync-crypto";
import { oneDriveTokenProvider } from "@/lib/sync/onedrive-session";
import { appFetch } from "@/lib/http-client";
import { dexieBookReader } from "@/lib/sync/dexie-book-reader";
import { loadPublishState, publishChanges, type PublishResult } from "@/lib/sync/pc-publisher";

const DEVICE_KEY = "ym_sync_device_id";

/** This PC's device id. Created once and kept in local storage. */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[a-z0-9]{6,32}$/.test(existing)) return existing;
    const fresh = generateDeviceId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return generateDeviceId();
  }
}

/** The OneDrive folder for sync, using the encrypted token vault. */
export function oneDriveSyncFolder(store: KeyStore): CloudFolder {
  return createOneDriveFolder(oneDriveTokenProvider(store), appFetch);
}

/**
 * Turn sync on for a company: makes sure the company key exists and that its
 * recovery copy is saved in the cloud folder.
 */
export async function turnOnSync(
  folder: CloudFolder,
  store: KeyStore,
  companyId: string,
): Promise<{ recoveryCreated: boolean }> {
  const res = await ensureRecoveryCopy(folder, store, companyId);
  return { recoveryCreated: res.created };
}

/** Create a pairing offer for a phone (QR text and PIN, valid for five minutes). */
export async function startPhonePairing(
  store: KeyStore,
  companyId: string,
  now?: number,
): Promise<PairingOffer & { pcDeviceId: string }> {
  const companyKey = await getOrCreateCompanyKey(store, companyId);
  const pcDeviceId = getOrCreateDeviceId();
  const offer = await createPairingOffer({ companyId, companyKey, pcDeviceId, now });
  return { ...offer, pcDeviceId };
}

// ---------- Sync on / Sync now (PC) ----------

const syncOnKey = (companyId: string) => `ym_sync_on:${companyId}`;

/** Whether sync was turned on for this company on this PC. */
export function isSyncOn(companyId: string): boolean {
  try {
    return localStorage.getItem(syncOnKey(companyId)) === "1";
  } catch {
    return false;
  }
}

export function setSyncOn(companyId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(syncOnKey(companyId), "1");
    else localStorage.removeItem(syncOnKey(companyId));
  } catch {
    // Ignore: the user can turn sync on again.
  }
}

/**
 * Publish this company's changes to the phone through OneDrive.
 * Requires sync to be turned on for the company first.
 */
export async function syncNowPc(store: KeyStore, companyId: string): Promise<PublishResult> {
  if (!isSyncOn(companyId)) throw new Error("Turn on sync for this company first.");
  const folder = oneDriveSyncFolder(store);
  const key = await getOrCreateCompanyKey(store, companyId);
  return publishChanges({
    folder,
    key,
    companyId,
    deviceId: getOrCreateDeviceId(),
    reader: dexieBookReader,
    state: loadPublishState(companyId),
  });
}
