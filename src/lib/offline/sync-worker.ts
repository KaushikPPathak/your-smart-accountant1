// src/lib/offline/sync-worker.ts
// Singleton background worker that drains the outbox whenever
// connectivity returns or every 30 s while online.

import { drainOutbox } from "./outbox";
import { refreshAllCachedCreds } from "./creds-cache";

let started = false;

/**
 * Ensures background network calls initiated by the worker threads
 * are injected with authorization keys to prevent 401 status blocks.
 */
function applyGlobalWorkerSecurityInterceptor() {
  if (typeof window === "undefined") return;

  const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1a3d6Y2RkaGtocXRicm5ubmV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzgwOTUsImV4cCI6MjA5MzgxNDA5NX0.Pn2-TWfiyYXVZqfFdCVKTD27Z95RWjRSgrXvZgqQ76A";
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // Intercept any background sub-scripts pinging the auth/v1/health status loop
    if (url.includes("supabase.co/auth/v1/health") || url.includes("supabase.co/rest/v1")) {
      const modifiedInit = { ...(init || {}) };
      const headers = new Headers(modifiedInit.headers || {});

      if (!headers.has("apikey")) {
        headers.set("apikey", SUPABASE_ANON_KEY);
      }
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
      }

      modifiedInit.headers = headers;
      return originalFetch.call(this, input, modifiedInit);
    }

    return originalFetch.call(this, input, init);
  };
}

export function startSyncWorker() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  // Run security header patch on background networking methods
  applyGlobalWorkerSecurityInterceptor();

  const tick = () => {
    void drainOutbox().catch(() => undefined);
    void refreshAllCachedCreds().catch(() => undefined);
  };

  window.addEventListener("online", tick);
  // Run once on boot in case there's a backlog.
  setTimeout(tick, 1500);
  // Then periodically while the tab is open.
  setInterval(tick, 30_000);
}
