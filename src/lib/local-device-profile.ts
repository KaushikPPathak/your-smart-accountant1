// Local-first device profile.
//
// The app is local-first: on a fresh install the user should be able to
// jump straight into creating a company without picking a username, an
// email or a password. This module creates a hidden "device profile" that
// satisfies the internal staff-session gate (LockGate in __root.tsx) so
// the rest of the app can run unchanged, but is completely invisible to
// the user. No cloud row is created — the profile lives entirely in
// localStorage on this device.
//
// When the user later chooses to connect an account, we keep the local
// device id around so we can re-tag existing local companies to the new
// account id (see link-local-to-account.ts).

import { markUnlocked, isUnlocked } from "./staff-session";
import { setLocalOnlyMode, isLocalOnlyMode } from "./local-only-mode";

const DEVICE_ID_KEY = "ym_local_device_id";
const READY_KEY = "ym_local_profile_ready";
const LOCAL_USERNAME = "local-device";

function readOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh =
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return "local-device";
  }
}

export function hasLocalDeviceProfile(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === "1" || localStorage.getItem(READY_KEY) === "linked";
  } catch {
    return false;
  }
}

export function getLocalDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Idempotent. Ensures a hidden local staff session is active so the
 * LockGate lets the user through, and pins the app into local-only
 * mode. Safe to call on every boot.
 */
export function ensureLocalDeviceProfile(): { id: string } {
  const id = readOrCreateDeviceId();
  if (!isLocalOnlyMode()) setLocalOnlyMode(true);
  if (!isUnlocked()) {
    markUnlocked({
      id,
      name: "This device",
      role: "admin",
      username: LOCAL_USERNAME,
    });
  }
  try {
    if (localStorage.getItem(READY_KEY) !== "linked") {
      localStorage.setItem(READY_KEY, "1");
    }
  } catch {
    /* ignore */
  }
  return { id };
}

/**
 * Marks the local profile as "linked" — i.e. the user has connected a
 * cloud account on top of the local device. We keep the local device id
 * around; only the flag changes.
 */
export function markLocalProfileLinked(): void {
  try {
    localStorage.setItem(READY_KEY, "linked");
  } catch {
    /* ignore */
  }
}

export function isLocalProfileLinked(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === "linked";
  } catch {
    return false;
  }
}
