// Layer 6 — Staged rollout.
//
// Two mechanisms live here:
//
// 1. Release CHANNEL — user-selected: "stable" (default) or "beta".
//    Beta users see new features first. If a bug slips in, only beta
//    users are hit and we roll back before it reaches stable.
//
// 2. Feature FLAGS with percentage rollout — deterministic per-device.
//    `isFeatureEnabled("new-invoice-pdf", 10)` returns true for exactly
//    ~10% of devices, and the same device always gets the same answer
//    (so a user does not see a feature flicker on/off across sessions).
//
// Both mechanisms are local-only. No network, no server flag service.
// Ship a new build with the percentage bumped from 10 → 50 → 100 to
// widen the rollout across releases.

const CHANNEL_KEY = "rollout.channel.v1";
const DEVICE_ID_KEY = "rollout.device-id.v1";

export type ReleaseChannel = "stable" | "beta";

function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch { return null; }
}

/** Current release channel. Defaults to "stable". */
export function getChannel(): ReleaseChannel {
  const s = ls();
  if (!s) return "stable";
  const v = s.getItem(CHANNEL_KEY);
  return v === "beta" ? "beta" : "stable";
}

export function setChannel(ch: ReleaseChannel): void {
  const s = ls();
  if (!s) return;
  try { s.setItem(CHANNEL_KEY, ch); } catch { /* ignore */ }
}

/**
 * Stable per-device identifier. Generated once, reused forever.
 * Used only for deterministic feature-flag bucketing — never sent anywhere.
 */
export function getDeviceId(): string {
  const s = ls();
  if (!s) {
    // No storage — generate a per-session id; bucketing will be
    // inconsistent across reloads but the app still works.
    return "session-" + Math.random().toString(36).slice(2, 14);
  }
  let id = s.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    try { s.setItem(DEVICE_ID_KEY, id); } catch { /* ignore */ }
  }
  return id;
}

/**
 * FNV-1a 32-bit hash — small, fast, deterministic. Good enough for
 * bucketing device ids into a 0–99 percentage.
 */
export function hashToPercent(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Fold to unsigned, then mod 100.
  return (h >>> 0) % 100;
}

/**
 * Is a feature enabled on this device?
 *  - channel === "beta" → always enabled (beta users always opted in)
 *  - percent >= 100     → always enabled
 *  - percent <= 0       → never enabled
 *  - otherwise          → deterministic per-device bucket
 */
export function isFeatureEnabled(featureKey: string, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  if (getChannel() === "beta") return true;
  const bucket = hashToPercent(getDeviceId() + ":" + featureKey);
  return bucket < percent;
}
