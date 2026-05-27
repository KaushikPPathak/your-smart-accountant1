// Online/offline detection.
//
// We trust `navigator.onLine` as the cheap signal and back it up with a
// best-effort ping when callers need a confident answer (e.g. before
// flushing the outbox).

import { useEffect, useState } from "react";

export function isOnlineNow(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

let lastPingAt = 0;
let lastPingResult = true;

/**
 * Confidence check: navigator.onLine can lie on some platforms (Tauri on
 * Linux, captive portals). A lightweight HEAD to the Supabase URL clarifies
 * whether we can actually reach our backend. Cached for 10 seconds to avoid
 * hammering the network.
 */
export async function pingOnline(timeoutMs = 2500): Promise<boolean> {
  if (!isOnlineNow()) return false;
  const now = Date.now();
  if (now - lastPingAt < 10_000) return lastPingResult;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) {
    lastPingAt = now;
    lastPingResult = isOnlineNow();
    return lastPingResult;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // /auth/v1/health is publicly reachable and cheap.
    const res = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
    });
    lastPingResult = res.ok;
  } catch {
    lastPingResult = false;
  } finally {
    clearTimeout(t);
    lastPingAt = Date.now();
  }
  return lastPingResult;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(isOnlineNow());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
