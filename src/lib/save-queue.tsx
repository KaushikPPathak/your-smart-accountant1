import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode, startTransition } from "react";
import { toast } from "sonner";
import { markSaved, markFailure, clearFailures } from "./save-status";

export interface PendingJob {
  id: string;
  label: string;
  attempts: number;
  lastError?: string;
  run: () => Promise<void>;
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

async function flush() {
  if (inFlight) return;
  inFlight = true;
  try {
    while (queue.length > 0) {
      const job = queue[0];
      try {
        await job.run();
        queue.shift();
        markSaved(job.label);
        bump();
      } catch (e) {
        job.attempts += 1;
        job.lastError = e instanceof Error ? e.message : String(e);
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
export function enqueueSave(label: string, run: () => Promise<void>) {
  const job: PendingJob = { id: crypto.randomUUID(), label, attempts: 0, run };
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
