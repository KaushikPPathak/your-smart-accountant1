// Bill sundries — non-item charges that appear on a voucher (freight, packing,
// discount, round-off, insurance, etc.). Persisted per-voucher in
// `cache_bill_sundries` (Dexie, local-only). Postings are emitted by
// `buildItemVoucherPostings` so books stay balanced.
//
// Sign convention: `amount_paise` is SIGNED.
//   positive → adds to invoice total   (e.g. Freight ₹500)
//   negative → reduces invoice total   (e.g. Trade discount −₹200)
//
// The sundry_type is a coarse tag used only for UI grouping / reporting.
// The actual GL account is chosen by `ledger_id` — that is the source of truth
// for postings, not the type.

export type SundryType =
  | "freight"
  | "packing"
  | "insurance"
  | "loading"
  | "discount"
  | "round_off"
  | "other";

export interface Sundry {
  id: string;              // uuid, stable across edits
  sundry_type: SundryType;
  ledger_id: string;       // GL account this sundry posts against
  amount_paise: number;    // signed (see convention above)
  narration?: string | null;
}

/** Default sign for a fresh sundry of the given type. UI hint only. */
export function defaultSignForType(t: SundryType): 1 | -1 {
  return t === "discount" ? -1 : 1;
}

export const SUNDRY_TYPE_LABELS: Record<SundryType, string> = {
  freight: "Freight",
  packing: "Packing",
  insurance: "Insurance",
  loading: "Loading",
  discount: "Discount",
  round_off: "Round Off",
  other: "Other Charge",
};

/** Net signed paise for a list of sundries. */
export function netSundryPaise(list: readonly Sundry[]): number {
  return list.reduce((s, x) => s + (x.amount_paise || 0), 0);
}
