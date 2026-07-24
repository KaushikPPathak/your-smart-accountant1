// Cache invalidation event bus.
//
// Writers (voucher save, ledger create, item update, …) call `emitDataChange`
// with the kind of data that changed. Subscribers (answer cache, semantic
// index, warm-up scheduler) receive the event and invalidate only the scopes
// that actually depend on it — no more blanket cache wipes.

export type DataChangeKind =
  | "voucher"        // any voucher insert/update/delete
  | "ledger"         // ledger master CRUD
  | "item"           // item master CRUD
  | "settings"       // company settings row
  | "period_lock";   // year-end / period lock toggle

export interface DataChangeEvent {
  companyId: string;
  kind: DataChangeKind;
  /** Optional finer-grained scopes: party ledger ids, item ids, dates, … */
  scopes?: string[];
  at: number;
}

// Which AI intents each kind of data change can invalidate. Kept intentionally
// broad — false-positives just re-run the LLM, false-negatives serve stale
// numbers (much worse).
export const INTENT_DEPS: Record<DataChangeKind, string[]> = {
  voucher: [
    "trial_balance", "profit_loss", "balance_sheet", "cash_bank",
    "outstanding", "ageing", "day_book", "ledger", "gst", "stock",
    "sales_register", "purchase_register",
  ],
  ledger: ["ledger", "trial_balance", "outstanding", "party", "gst"],
  item:   ["stock", "sales_register", "purchase_register"],
  settings:    ["gst", "company"],
  period_lock: ["trial_balance", "profit_loss", "balance_sheet"],
};

type Listener = (e: DataChangeEvent) => void;
const listeners = new Set<Listener>();

export function onDataChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Pending microtask dispatches — exposed via flushDataChange() so tests and
// any rare caller that MUST read derived state on the same tick can drain
// the queue synchronously.
const pending: Array<() => void> = [];

export interface EmitOptions {
  /** Run listeners synchronously in the same tick. Use only when a caller
   * must read a derived value immediately after emit (rare — default async
   * keeps keystroke paths free). */
  sync?: boolean;
}

export function emitDataChange(
  companyId: string,
  kind: DataChangeKind,
  scopes?: string[],
  opts?: EmitOptions,
): void {
  if (!companyId) return;
  const evt: DataChangeEvent = { companyId, kind, scopes, at: Date.now() };
  const dispatch = () => {
    for (const fn of listeners) {
      try { fn(evt); } catch { /* isolate */ }
    }
  };
  if (opts?.sync) { dispatch(); return; }
  // Default: async fan-out so a synchronous caller (e.g. voucher save on
  // Enter) never pays for subscriber work (answer cache, semantic index,
  // warm-up) on the same tick that dispatched the event.
  pending.push(dispatch);
  const drain = () => {
    const jobs = pending.splice(0);
    for (const j of jobs) j();
  };
  if (typeof queueMicrotask === "function") queueMicrotask(drain);
  else Promise.resolve().then(drain);
}

/** Drain any queued async dispatches immediately. Intended for tests and
 * the rare caller that needs to read derived state right after emit. */
export function flushDataChange(): void {
  const jobs = pending.splice(0);
  for (const j of jobs) j();
}

