// Singleton background worker that drains the outbox whenever
// connectivity returns or every 30 s while online.

import { drainOutbox } from "./outbox";
import { refreshAllCachedCreds } from "./creds-cache";

let started = false;

export function startSyncWorker() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

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
