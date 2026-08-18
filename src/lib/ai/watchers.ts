// Silent watchers — periodic background rescans of the anomaly engine.
//
// This is Phase B of the assistant roadmap. The morning briefing card runs
// once on dashboard load; watchers run for the whole session so a duplicate
// voucher entered at 3pm doesn't wait until tomorrow to surface. Everything
// runs on-device against IndexedDB, so it costs nothing and leaks nothing.
//
// Notification model: we remember the set of anomaly ids we've already
// surfaced today (per company, in localStorage) so the user isn't spammed
// with the same alert every 5 minutes. Only "danger" and "warn" trigger a
// toast; "info" waits for the next morning briefing.

import { scanAllAnomalies, type Anomaly } from "./anomalies";
import { offlineDb } from "../offline/db";

const SNOOZE_DURATION = 4 * 60 * 60 * 1000; // 4 hours snooze default

const SEEN_KEY = (companyId: string, date: string) => `ai.watcher.seen:${companyId}:${date}`;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_THROTTLE_MS = 30 * 1000;         // don't fire when tab hidden more than this

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadSeen(companyId: string): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY(companyId, todayISO()));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(companyId: string, seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY(companyId, todayISO()), JSON.stringify([...seen]));
  } catch {
    // ignore quota errors — the watcher will just re-alert tomorrow
  }
}

export interface WatcherHandle {
  stop: () => void;
  /** Force a rescan right now (useful after saves). */
  rescan: () => Promise<void>;
}

export interface WatcherOptions {
  intervalMs?: number;
  /** Called for each freshly-observed danger/warn anomaly. */
  onNew: (anomaly: Anomaly, actions: { snooze: () => Promise<void>; never: () => Promise<void> }) => void;
  /** Optional: full list callback for status bars / debug panels. */
  onScan?: (all: Anomaly[]) => void;
}

/**
 * Start watching a company's books. Returns a handle whose stop() must be
 * called on unmount. Safe to call repeatedly — the caller is expected to
 * stop the previous handle before spawning a new one.
 */
export function startWatchers(companyId: string, opts: WatcherOptions): WatcherHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastRun = 0;

  const tick = async () => {
    if (stopped || running) return;
    // Skip if the tab is hidden and we already ran recently — no point burning
    // battery re-scanning a paused app.
    if (typeof document !== "undefined" && document.hidden && Date.now() - lastRun < IDLE_THROTTLE_MS) {
      return;
    }
    running = true;
    try {
      const settings = await offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
      const dismissed = settings?.dismissed_notifications || [];
      const snoozed = settings?.snoozed_notifications || {};
      const now = Date.now();

      const all = await scanAllAnomalies(companyId);
      lastRun = now;
      if (stopped) return;
      opts.onScan?.(all);

      const seen = loadSeen(companyId);
      let mutatedSeen = false;

      for (const a of all) {
        if (a.severity === "info") continue;
        if (dismissed.includes(a.id)) continue;
        if (snoozed[a.id] && now < snoozed[a.id]) continue;
        if (seen.has(a.id)) continue;

        seen.add(a.id);
        mutatedSeen = true;

        const snooze = async () => {
          const current = await offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
          const nextSnoozed = { ...(current?.snoozed_notifications || {}), [a.id]: Date.now() + SNOOZE_DURATION };
          await offlineDb.cache_company_settings.update(current.id, { snoozed_notifications: nextSnoozed });
        };

        const never = async () => {
          const current = await offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
          const nextDismissed = Array.from(new Set([...(current?.dismissed_notifications || []), a.id]));
          await offlineDb.cache_company_settings.update(current.id, { dismissed_notifications: nextDismissed });
        };

        try { 
          opts.onNew(a, { snooze, never }); 
        } catch { /* consumer errors mustn't break the loop */ }
      }
      if (mutatedSeen) saveSeen(companyId, seen);
    } catch {
      // Swallow — we retry on the next tick. Never let a scanner bug
      // take down the whole app.
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  };

  // First scan runs after a short delay so it doesn't compete with the
  // initial morning briefing render.
  timer = setTimeout(async () => {
    await tick();
    schedule();
  }, 15_000);

  const onVisibility = () => {
    if (typeof document !== "undefined" && !document.hidden) {
      void tick();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    rescan: tick,
  };
}
