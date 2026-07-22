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

export function emitDataChange(
  companyId: string,
  kind: DataChangeKind,
  scopes?: string[],
): void {
  if (!companyId) return;
  const evt: DataChangeEvent = { companyId, kind, scopes, at: Date.now() };
  for (const fn of listeners) {
    try { fn(evt); } catch { /* isolate */ }
  }
}
