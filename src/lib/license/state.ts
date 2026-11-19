// License + trial state. Everything is stored in localStorage — no network
// calls, ever. Trial starts on first launch and lasts 30 days.
//
//   licensed  → paid, in-date, activated on this machine
//   trial     → within 30-day window, no key entered
//   expired   → trial ended, no key entered (or invalid / expired key)
//
// Feature gates use `hasFeature()` below. The read-only lock (blocking
// voucher creation) uses `isReadOnlyLocked()`.

import { verifyLicenseKey, type LicensePayload, type Plan } from "./verify";
import { tryGetMachineId } from "./machine-id";

const KEY_LIC = "sm.license.v1";
const KEY_TRIAL = "sm.trial_started_at.v1";

export const TRIAL_DAYS = 30;

export type LicenseMode = "trial" | "licensed" | "expired";

export interface LicenseState {
  mode: LicenseMode;
  plan: Plan | "trial";
  daysLeft: number;                 // trial only, else 0
  expiresAt: Date | null;
  customerName: string | null;
  customerEmail: string | null;
  licenseId: string | null;
  deviceCount: number;              // devices already activated on this key
  maxDevices: number;               // 0 if no key
}

interface StoredLicense {
  key: string;
  payload: LicensePayload;
  devices: string[];                // machine ids that have activated
}

function readTrialStart(): number {
  try {
    const v = localStorage.getItem(KEY_TRIAL);
    if (v) return parseInt(v, 10);
    const now = Date.now();
    localStorage.setItem(KEY_TRIAL, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function readStoredLicense(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(KEY_LIC);
    if (!raw) return null;
    return JSON.parse(raw) as StoredLicense;
  } catch {
    return null;
  }
}

/** Writes the license and reads it back. Returns false if it was not saved. */
function writeStoredLicense(v: StoredLicense | null): boolean {
  try {
    if (v) {
      const raw = JSON.stringify(v);
      localStorage.setItem(KEY_LIC, raw);
      return localStorage.getItem(KEY_LIC) === raw;
    }
    localStorage.removeItem(KEY_LIC);
    return localStorage.getItem(KEY_LIC) === null;
  } catch {
    return false;
  }
}

export async function getLicenseState(): Promise<LicenseState> {
  const stored = readStoredLicense();
  if (stored) {
    const res = await verifyLicenseKey(stored.key);
    const machineId = tryGetMachineId();
    if (res.ok && machineId) {
      const activated = stored.devices.includes(machineId);
      const overLimit = !activated && stored.devices.length >= res.payload.d;
      if (activated || !overLimit) {
        return {
          mode: "licensed",
          plan: res.plan,
          daysLeft: 0,
          expiresAt: res.expiresAt,
          customerName: res.payload.n,
          customerEmail: res.payload.e,
          licenseId: res.payload.id,
          deviceCount: stored.devices.length,
          maxDevices: res.payload.d,
        };
      }
    }
    // Key stored but no longer valid — fall through to trial/expired.
  }

  const started = readTrialStart();
  const elapsed = Math.floor((Date.now() - started) / (24 * 3600 * 1000));
  const daysLeft = Math.max(0, TRIAL_DAYS - elapsed);
  const base: LicenseState = {
    mode: daysLeft > 0 ? "trial" : "expired",
    plan: "trial",
    daysLeft,
    expiresAt: null,
    customerName: null,
    customerEmail: null,
    licenseId: null,
    deviceCount: 0,
    maxDevices: 0,
  };
  return base;
}

export interface ActivateResult {
  ok: boolean;
  reason?:
    | "malformed"
    | "bad_signature"
    | "no_public_key"
    | "expired"
    | "device_limit_reached"
    | "storage_unavailable";
  state?: LicenseState;
}

export async function activateLicenseKey(rawKey: string): Promise<ActivateResult> {
  const res = await verifyLicenseKey(rawKey);
  if (!res.ok) return { ok: false, reason: res.reason };

  const machineId = tryGetMachineId();
  if (!machineId) return { ok: false, reason: "storage_unavailable" };

  const existing = readStoredLicense();
  const sameLicense = existing?.payload.id === res.payload.id;
  const devices = sameLicense
    ? Array.from(new Set([...existing!.devices, machineId]))
    : [machineId];

  if (devices.length > res.payload.d) {
    return { ok: false, reason: "device_limit_reached" };
  }

  const saved = writeStoredLicense({ key: rawKey.trim(), payload: res.payload, devices });
  if (!saved) return { ok: false, reason: "storage_unavailable" };
  const state = await getLicenseState();
  // A save that reads back but is not licensed on this device means the seat was not kept.
  if (state.mode !== "licensed") return { ok: false, reason: "storage_unavailable" };
  return { ok: true, state };
}

export function deactivateLicense(): void {
  writeStoredLicense(null);
}

// --- Feature gate --------------------------------------------------------

export type LicensedFeature =
  | "gstr1_json"
  | "einvoice"
  | "cloud_backup"
  | "multi_company";

/**
 * True if the CURRENT license state permits the feature.
 *
 * Trial gets full functionality EXCEPT cloud_backup (which is a genuine
 * recurring paid service, not just a code gate).
 */
export function hasFeature(state: LicenseState, feature: LicensedFeature): boolean {
  if (state.mode === "licensed") {
    if (state.plan === "basic") {
      // Basic = vouchers + reports only.
      return feature !== "einvoice" && feature !== "cloud_backup"
        && feature !== "gstr1_json";
    }
    return true; // pro | lifetime
  }
  if (state.mode === "trial") {
    return feature !== "cloud_backup";
  }
  return false;
}

/** Voucher creation locked once trial ends and no valid key is installed. */
export function isReadOnlyLocked(state: LicenseState): boolean {
  return state.mode === "expired";
}
