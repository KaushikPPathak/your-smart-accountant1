// src/lib/offline/sync-worker.ts
// Background worker: drains the outbox AND pulls cloud snapshots so the
// local cache stays warm for offline use.

import { drainOutbox, queueSize } from "./outbox";
import { refreshAllCachedCreds } from "./creds-cache";
import { pullSnapshot } from "./snapshot";
import { rememberNetworkBlocked } from "./cache-read";

let started = false;

function applyGlobalWorkerSecurityInterceptor() {
  if (typeof window === "undefined") return;

  const SUPABASE_ANON_KEY =
    import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env?.VITE_SUPABASE_ANON_KEY ||
    "";
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Silently short-circuit health-probe calls made by browser extensions /
    // injected scripts (frame_ant.js etc.) — they hit /auth/v1/health WITHOUT
    // an apikey and spam the console with 401s. We don't need the result.
    if (url.includes("supabase.co/auth/v1/health")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }

    if (
      SUPABASE_ANON_KEY &&
      (url.includes("supabase.co/rest/v1") || url.includes("supabase.co/auth/v1"))
    ) {
      const modifiedInit = { ...(init || {}) };
      const headers = new Headers(modifiedInit.headers || {});
      if (!headers.has("apikey")) headers.set("apikey", SUPABASE_ANON_KEY);
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
      modifiedInit.headers = headers;
      try {
        return await originalFetch.call(this, input, modifiedInit);
      } catch (err) {
        rememberNetworkBlocked();
        throw err;
      }
    }

    try {
      return await originalFetch.call(this, input, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      if (/failed to fetch|networkerror|offline/i.test(msg)) rememberNetworkBlocked();
      throw err;
    }
  };
}

const LAST_MODE_KEY = "ym_last_work_mode"; // "online" | "offline"

function rememberWorkMode(mode: "online" | "offline") {
  try { localStorage.setItem(LAST_MODE_KEY, mode); } catch { /* ignore */ }
}

export function getLastWorkMode(): "online" | "offline" | null {
  try { return (localStorage.getItem(LAST_MODE_KEY) as any) || null; } catch { return null; }
}

async function tick(): Promise<void> {
  // 1) push local changes first so subsequent pull sees authoritative data.
  //    This handles the "worked offline last time → sync back to cloud" case.
  try {
    const pushed = await drainOutbox();
    if (pushed.failed > 0 || await queueSize() > 0) return;
  } catch { return; }
  // 2) refresh login cache for offline auth
  try { await refreshAllCachedCreds(); } catch { /* ignore */ }
  // 3) Full pull cloud → local for every company the user belongs to. This
  //    handles the "worked online last time → make available offline" case
  //    AND keeps the last-used company hot for offline work.
  try {
    await pullSnapshot({ full: true });
    rememberWorkMode("online");
  } catch { /* ignore */ }
}

export function startSyncWorker() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  applyGlobalWorkerSecurityInterceptor();

  // Drain + pull whenever connectivity returns
  window.addEventListener("online", () => { void tick(); });
  window.addEventListener("offline", () => { rememberWorkMode("offline"); });
  // Pull again when the tab becomes visible — catches "laptop opened again"
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tick();
  });
  // Boot run
  setTimeout(() => { void tick(); }, 1500);
  // Periodic sync (60s) while the tab is open
  setInterval(() => { void tick(); }, 60_000);
}

/** Manual trigger for the status drawer. */
export async function runSyncNow(): Promise<void> {
  await tick();
}
