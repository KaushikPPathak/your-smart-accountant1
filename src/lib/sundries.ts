// Bill sundries — non-item charges that appear on a voucher (freight, packing,
// discount, round-off, insurance, etc.). Persisted per-voucher in
// `cache_bill_sundries` (Dexie, local-only). Postings are emitted by
// `buildItemVoucherPostings` so books stay balanced.
//
// Sign convention: `amount_paise` is SIGNED.
//   positive → adds to invoice total   (e.g. Freight ₹500)
//   negative → reduces invoice total   (e.g. Trade discount −₹200)
//
// A sundry can be entered as a flat ₹ amount OR as a percentage. It can also
// be applied BEFORE GST (folded into the taxable value so tax recalculates)
// or AFTER GST (added straight to the grand total, no tax effect).
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

/** How the sundry value is entered. */
export type SundryMode = "amount" | "percent";

/** Where in the totals pipeline the sundry is applied. */
export type SundryStage = "pre_gst" | "post_gst";

export interface Sundry {
  id: string;              // uuid, stable across edits
  sundry_type: SundryType;
  ledger_id: string;       // GL account this sundry posts against
  /**
   * Resolved signed paise. This is what postings and reports consume. For
   * percent sundries the UI recomputes this whenever the underlying base
   * changes and writes the fresh value here on save.
   */
  amount_paise: number;
  /** "amount" (default) or "percent". Optional for backward compat. */
  mode?: SundryMode;
  /**
   * Percent value × 100 (basis points), so 2.5% is stored as 250. Only used
   * when `mode === "percent"`. Sign lives in the sign of `amount_paise` and
   * a parallel `sign` field on the UI state.
   */
  rate_bps?: number;
  /** "pre_gst" folds into taxable value; "post_gst" adds after tax. Default post. */
  apply_stage?: SundryStage;
  narration?: string | null;
}

/** Default sign for a fresh sundry of the given type. UI hint only. */
export function defaultSignForType(t: SundryType): 1 | -1 {
  return t === "discount" ? -1 : 1;
}

/** Default apply stage. Discount goes pre-GST by convention; freight etc. post-GST. */
export function defaultStageForType(t: SundryType): SundryStage {
  return t === "discount" ? "pre_gst" : "post_gst";
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

export const SUNDRY_STAGE_LABELS: Record<SundryStage, string> = {
  pre_gst: "Before GST",
  post_gst: "After GST",
};

/** Net signed paise for a list of sundries (uses already-resolved amount_paise). */
export function netSundryPaise(list: readonly Sundry[]): number {
  return list.reduce((s, x) => s + (x.amount_paise || 0), 0);
}

/** Split a list into pre-GST vs post-GST buckets. Unknown stage → post_gst. */
export function splitSundriesByStage(list: readonly Sundry[]): {
  preGst: Sundry[];
  postGst: Sundry[];
} {
  const preGst: Sundry[] = [];
  const postGst: Sundry[] = [];
  for (const s of list) {
    if ((s.apply_stage ?? "post_gst") === "pre_gst") preGst.push(s);
    else postGst.push(s);
  }
  return { preGst, postGst };
}

/**
 * Resolve a signed paise amount for a sundry given the base it should be
 * charged against. For `mode === "amount"` the stored amount is returned
 * as-is; for `mode === "percent"` the base is multiplied by `rate_bps`
 * and the sign of the current `amount_paise` is preserved.
 */
export function resolveSundryPaise(s: Sundry, basePaise: number): number {
  if ((s.mode ?? "amount") === "percent") {
    const bps = s.rate_bps ?? 0;
    const sign = s.amount_paise < 0 ? -1 : 1;
    return Math.round((basePaise * bps) / 10_000) * sign;
  }
  return s.amount_paise || 0;
}
