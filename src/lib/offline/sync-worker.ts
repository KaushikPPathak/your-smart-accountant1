// src/lib/offline/sync-worker.ts
// Background worker: drains the outbox AND pulls cloud snapshots so the
// local cache stays warm for offline use.

import { drainOutbox } from "./outbox";
import { refreshAllCachedCreds } from "./creds-cache";
import { pullSnapshot } from "./snapshot";

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

    if (
      SUPABASE_ANON_KEY &&
      (url.includes("supabase.co/auth/v1/health") ||
        url.includes("supabase.co/rest/v1"))
    ) {
      const modifiedInit = { ...(init || {}) };
      const headers = new Headers(modifiedInit.headers || {});
      if (!headers.has("apikey")) headers.set("apikey", SUPABASE_ANON_KEY);
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
      modifiedInit.headers = headers;
      return originalFetch.call(this, input, modifiedInit);
    }

    return originalFetch.call(this, input, init);
  };
}

async function tick(): Promise<void> {
  // 1) push local changes first so subsequent pull sees authoritative data
  try { await drainOutbox(); } catch { /* ignore */ }
  // 2) refresh login cache for offline auth
  try { await refreshAllCachedCreds(); } catch { /* ignore */ }
  // 3) pull cloud → local snapshot for offline reads
  try { await pullSnapshot(); } catch { /* ignore */ }
}

export function startSyncWorker() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  applyGlobalWorkerSecurityInterceptor();

  // Drain + pull whenever connectivity returns
  window.addEventListener("online", () => { void tick(); });
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
