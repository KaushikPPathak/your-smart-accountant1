// src/lib/offline/sync-worker.ts
// Background worker: drains the outbox AND pulls cloud snapshots so the
// local cache stays warm for offline use.

import { drainOutbox, queueSize } from "./outbox";
import { refreshAllCachedCreds } from "./creds-cache";
import { pullSnapshot } from "./snapshot";
import { rememberNetworkBlocked } from "./cache-read";
import { requestPersistentStorage, startStorageWatcher } from "./storage-quota";
import { drainEinvoiceQueue } from "./einvoice-queue";
import { refreshSessionIfDue, warnIfSessionStale } from "./session-refresh";

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
  // Local-only mode: no cloud sync of any business data. Just quietly do
  // nothing so no server calls are made.
  const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
  if (isLocalOnlyMode()) { rememberWorkMode("offline"); return; }
  // 0) Keep the Supabase refresh-token clock reset. Rate-limited to once
  //    every 6h internally so this is cheap to call every tick. Without
  //    this, a user who's online only briefly won't hit the built-in
  //    autoRefresh (which only fires near access-token expiry) and could
  //    silently burn down the 30-day refresh-token window.
  try { await refreshSessionIfDue(); } catch { /* ignore */ }
  // If we've gone dangerously long without a successful refresh, tell them.
  try { await warnIfSessionStale(); } catch { /* ignore */ }
  // 1) push local changes first so subsequent pull sees authoritative data.
  //    This handles the "worked offline last time → sync back to cloud" case.
  try {
    const pushed = await drainOutbox();
    if (pushed.failed > 0 || await queueSize() > 0) return;
  } catch { return; }
  // 2) refresh login cache for offline auth
  try { await refreshAllCachedCreds(); } catch { /* ignore */ }
  // 3) Keep the essential company/settings cache fresh. Full voucher/report
  //    snapshots are intentionally not run every 30s because they can be very
  //    large; the active company performs a throttled full hydrate separately.
  try {
    const result = await pullSnapshot({ full: false });
    if (result && Object.keys(result.errors).length === 0) {
      rememberWorkMode("online");
    }
  } catch { /* ignore */ }
  // 4) Retry deferred IRN / E-Way Bill portal calls that were queued while
  //    the device was offline or the GSP was unreachable.
  try { await drainEinvoiceQueue(); } catch { /* ignore */ }
}

export function startSyncWorker() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  applyGlobalWorkerSecurityInterceptor();

  // Ask the browser to keep our IndexedDB cache under storage pressure.
  // Best-effort: some grant automatically, iOS Safari usually declines but
  // still extends its 7-day eviction window.
  void requestPersistentStorage();

  // Watch storage usage and warn the user before the browser refuses writes.
  startStorageWatcher();


  // Drain + pull whenever connectivity returns
  window.addEventListener("online", () => { void tick(); });
  window.addEventListener("offline", () => { rememberWorkMode("offline"); });
  // Pull again when the tab becomes visible — catches "laptop opened again"
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tick();
  });
  // Boot run — wait until the UI has painted so sync can never slow launch.
  setTimeout(() => { void tick(); }, 3_000);
  // Periodic lightweight sync while the tab is open — keeps offline data fresh
  // without repeatedly downloading every voucher/report row.
  setInterval(() => { void tick(); }, 120_000);
}

/** Manual trigger for the status drawer. */
export async function runSyncNow(): Promise<void> {
  await tick();
}
