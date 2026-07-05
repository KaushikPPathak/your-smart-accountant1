// Proactive Supabase session refresh.
//
// Background
// ----------
// Supabase's default `autoRefreshToken: true` only fires when the access
// token is close to expiring (~1 hour) AND the tab is active. That's fine
// for typical usage but leaves a footgun for the offline-first case:
//
// • The Supabase *refresh token* is what keeps a user "signed in" across
//   sessions. It has a rolling 30-day inactivity window — every successful
//   refresh mints a NEW refresh token and resets that clock.
// • If the app never gets a chance to refresh (user offline for the whole
//   30-day window, or online only briefly and the access token isn't near
//   expiry so autoRefresh skips), the refresh token dies and the user must
//   re-sign-in on the next online session.
//
// This module closes that gap by force-refreshing the session on every
// online tick (rate-limited to once per 6h so we don't hammer the API).
// As long as the user is online for even a few seconds within any 30-day
// window, they stay signed in indefinitely.
//
// If a refresh fails because the token really did expire, we surface a
// non-blocking toast so the user knows to re-sign-in on the next visit,
// but the app continues to work offline via the cached login credentials —
// no data is destroyed and the outbox waits patiently for re-auth.

import { supabase } from "@/integrations/supabase/client";
import { rememberNetworkBlocked } from "./cache-read";

const LAST_REFRESH_KEY = "ym_last_session_refresh_at";
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6h — plenty to keep the 30-day clock reset
const WARN_AFTER_MS   = 20 * 24 * 60 * 60 * 1000; // 20 days since last successful refresh

let inFlight: Promise<void> | null = null;
let toastedExpiry = false;

function readLastRefresh(): number {
  try { return Number(localStorage.getItem(LAST_REFRESH_KEY) ?? 0) || 0; } catch { return 0; }
}
function writeLastRefresh(ts: number) {
  try { localStorage.setItem(LAST_REFRESH_KEY, String(ts)); } catch { /* ignore */ }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * Force a Supabase session refresh if we're online AND we haven't refreshed
 * in the last MIN_INTERVAL_MS. Silent — never throws, never blocks.
 * Returns the epoch-ms of the last successful refresh (0 if never).
 */
export async function refreshSessionIfDue(force = false): Promise<number> {
  if (!isOnline()) return readLastRefresh();
  if (inFlight) { await inFlight; return readLastRefresh(); }

  const last = readLastRefresh();
  if (!force && last && Date.now() - last < MIN_INTERVAL_MS) return last;

  inFlight = (async () => {
    try {
      // Only attempt if we actually have a session to refresh. Calling
      // refreshSession() with no session is a no-op that logs noise.
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return;

      const { error } = await supabase.auth.refreshSession();
      if (error) {
        // "Refresh Token Not Found" / "invalid_grant" → the 30-day window
        // really did elapse (or the user was signed out elsewhere). Fall
        // through to warn on the next warnIfSessionStale() call.
        const msg = String(error.message ?? "");
        if (/refresh token|invalid_grant|not found|expired/i.test(msg)) {
          // Leave last-refresh alone so the "stale" warning fires.
          return;
        }
        // Network / transient failure — remember so cache-read can behave.
        if (/failed to fetch|network|timeout/i.test(msg)) rememberNetworkBlocked();
        return;
      }
      writeLastRefresh(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      if (/failed to fetch|network|timeout/i.test(msg)) rememberNetworkBlocked();
    }
  })();

  try { await inFlight; } finally { inFlight = null; }
  return readLastRefresh();
}

/**
 * Called from the boot path and any UI-visible moment. If we've gone more
 * than WARN_AFTER_MS since a successful refresh, show a one-time toast so
 * the user knows to reconnect before the 30-day ceiling hits.
 */
export async function warnIfSessionStale(): Promise<void> {
  if (toastedExpiry) return;
  const last = readLastRefresh();
  if (!last) return; // never refreshed → probably first launch; nothing to warn
  const ageMs = Date.now() - last;
  if (ageMs < WARN_AFTER_MS) return;

  toastedExpiry = true;
  const daysLeft = Math.max(0, Math.ceil((30 * 24 * 60 * 60 * 1000 - ageMs) / (24 * 60 * 60 * 1000)));
  const { toast } = await import("sonner");
  toast.warning("Reconnect to the internet soon", {
    description: daysLeft > 0
      ? `You've worked offline for a while. Connect within ${daysLeft} day${daysLeft === 1 ? "" : "s"} to keep syncing automatically — no data will be lost either way.`
      : "You've worked offline past the sign-in window. Your data is safe on this device. Please sign in again when you're back online to push it to the cloud.",
    duration: 15_000,
  });
}

/** Seed the "last refresh" timestamp when we know the session is fresh
 *  (e.g. right after sign-in / sign-up). */
export function markSessionFresh() { writeLastRefresh(Date.now()); }

/** How many days since the last successful cloud handshake, for UI. */
export function daysSinceLastRefresh(): number {
  const last = readLastRefresh();
  if (!last) return 0;
  return Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000));
}
