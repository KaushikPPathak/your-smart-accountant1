import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode, startTransition } from "react";
import { toast } from "sonner";
import { markSaved, markFailure, clearFailures } from "./save-status";
import { describeError } from "./error-message";
import { isOnlineNow } from "./offline/online-status";
import { enqueueWrite } from "./offline/outbox";

export interface PersistSpec {
  executor: string;
  snap: unknown;
  companyId: string | null;
}

export interface PendingJob {
  id: string;
  label: string;
  attempts: number;
  lastError?: string;
  run: () => Promise<void>;
  persist?: PersistSpec;
}

const queue: PendingJob[] = [];
let inFlight = false;
const listeners = new Set<() => void>();
let version = 0;
function bump() { version++; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snap() { return version; }

type Idle = (cb: () => void) => void;
const ric: Idle = (typeof window !== "undefined" && (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback)
  ? ((window as unknown as { requestIdleCallback: Idle }).requestIdleCallback)
  : (cb) => setTimeout(cb, 0);

async function persistAndDrop(job: PendingJob): Promise<boolean> {
  if (!job.persist) return false;
  try {
    await enqueueWrite({
      op: "custom",
      table: "_custom",
      executor: job.persist.executor,
      payload: job.persist.snap,
      company_id: job.persist.companyId,
      label: job.label,
    });
    queue.shift();
    markSaved(job.label);
    if (queue.length === 0) clearFailures();
    bump();
    // Kick the outbox drain in the background so online users still see
    // the save land quickly, but the UI is never blocked by slow networks.
    if (isOnlineNow()) {
      void import("./offline/outbox").then((m) => m.drainOutbox()).catch(() => {});
    }
    toast.success(
      isOnlineNow()
        ? `${job.label} saved — syncing`
        : `${job.label} queued — will sync when online`,
    );
    return true;

  } catch (err) {
    console.error("Failed to persist to offline outbox", err);
    return false;
  }
}

async function flush() {
  if (inFlight) return;
  inFlight = true;
  try {
    while (queue.length > 0) {
      const job = queue[0];
      // Offline + persistable → skip the network attempt entirely and queue
      // straight to the durable outbox so it survives reload.
      if (job.persist && !isOnlineNow()) {
        if (await persistAndDrop(job)) continue;
      }
      try {
        await job.run();
        queue.shift();
        markSaved(job.label);
        if (job.attempts > 0) {
          toast.success(`${job.label} saved`);
        }
        if (queue.length === 0) clearFailures();
        bump();

      } catch (e) {
        // If we're offline (or went offline mid-flight) and the job is
        // persistable, route it to the outbox instead of marking failure.
        if (job.persist && !isOnlineNow()) {
          if (await persistAndDrop(job)) continue;
        }
        job.attempts += 1;
        job.lastError = describeError(e);
        console.error("Background save failed", { label: job.label, error: e });
        markFailure();
        bump();
        toast.error(`Save failed: ${job.label}`, { description: job.lastError });
        // Stop auto-retry; user retries from tray.
        break;
      }
    }
  } finally {
    inFlight = false;
  }
}

/** Enqueue a non-blocking save. Returns immediately. */
export function enqueueSave(
  label: string,
  run: () => Promise<void>,
  persist?: PersistSpec,
) {
  const job: PendingJob = { id: crypto.randomUUID(), label, attempts: 0, run, persist };
  queue.push(job);
  bump();
  startTransition(() => {
    ric(() => { void flush(); });
  });
}

export function retryPending() {
  startTransition(() => { ric(() => { void flush(); }); });
}

export function dropPending(id: string) {
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) { queue.splice(i, 1); bump(); }
  if (queue.every((j) => j.attempts === 0)) clearFailures();
}

export function usePendingSaves(): PendingJob[] {
  useSyncExternalStore(subscribe, snap, snap);
  return queue.slice();
}

const SaveQueueCtx = createContext<null>(null);
export function SaveQueueProvider({ children }: { children: ReactNode }) {
  // Just exists so future consumers can be aware of it; queue itself is module-level.
  const [, force] = useState(0);
  const cb = useCallback(() => force((n) => n + 1), []);
  useEffect(() => subscribe(cb), [cb]);
  return <SaveQueueCtx.Provider value={null}>{children}</SaveQueueCtx.Provider>;
}
