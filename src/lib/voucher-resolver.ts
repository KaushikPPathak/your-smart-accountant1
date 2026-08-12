/**
 * Voucher Resolver — Phase 1 (progressive disclosure engine)
 * ==========================================================
 *
 * Pure functions that decide, given masters + the current voucher context,
 * whether the UI should show a picker, silently auto-apply a value, or
 * block save until the user chooses. Zero React, zero I/O — trivially
 * testable and safe to call inside render.
 *
 * Contract: NEVER show a picker when a value can be inferred. This is the
 * hard rule set in .lovable/plan.md — see the "Rules to apply to every
 * voucher form" note.
 */
export type ResolveStatus = "auto" | "ambiguous" | "unresolved" | "hidden";

export interface Resolution<T> {
  /** `auto` = value found, don't render picker. */
  /** `ambiguous` = multiple candidates, MUST render picker (Save disabled). */
  /** `unresolved` = no candidate, render picker (Save disabled). */
  /** `hidden` = feature not applicable, don't render anything at all. */
  status: ResolveStatus;
  value?: T;
  candidates?: T[];
}

// -------------------------------------------------------------------------
// 1. Voucher series
// -------------------------------------------------------------------------

export interface VoucherSeries {
  id: string;
  company_id: string;
  voucher_type: string;
  name: string;
  prefix: string | null;
  is_default?: boolean;
}

/**
 * `series` should already be filtered to the current (company, voucher_type).
 * Result:
 *   - 0 rows: `hidden` — form uses the legacy next_voucher_number RPC.
 *   - 1 row: `auto` — apply silently, no picker.
 *   - >1 rows: `auto` with the default row (if any), otherwise `ambiguous`.
 */
export function resolveSeries(series: readonly VoucherSeries[]): Resolution<VoucherSeries> {
  if (series.length === 0) return { status: "hidden" };
  if (series.length === 1) return { status: "auto", value: series[0] };
  const defaultRow = series.find((s) => s.is_default);
  if (defaultRow) return { status: "auto", value: defaultRow, candidates: [...series] };
  return { status: "ambiguous", candidates: [...series] };
}

// -------------------------------------------------------------------------
// 2. Tax template (Busy "STPT")
// -------------------------------------------------------------------------

export interface TaxTemplate {
  id: string;
  company_id: string;
  name: string;
  gst_rate: number;         // percent, e.g. 12
  cess_rate: number;        // percent
  is_interstate: boolean;
  itc_eligible: boolean;
  is_reverse_charge: boolean;
  hsn_prefix?: string | null; // if set, template auto-matches items whose HSN starts here
}

export interface PartyForTax {
  gst_treatment: string | null; // 'regular' | 'composition' | 'unregistered' | 'sez' | 'export' | null
  state_code: string | null;
}
export interface ItemForTax {
  hsn_code: string | null;
  gst_rate: number | null;
}
export interface TaxContext {
  companyStateCode: string | null;
  party: PartyForTax | null;
  item: ItemForTax | null;
}

/**
 * Resolution order (most-specific → least-specific):
 *   1. Templates whose `hsn_prefix` matches the item's HSN AND whose
 *      `is_interstate` matches derived-from-party.
 *   2. Templates whose `gst_rate` matches the item's `gst_rate` AND
 *      whose `is_interstate` matches derived-from-party.
 * Reverse-charge, SEZ, export → treated as separate templates; if the party
 * is SEZ/export we filter to `is_reverse_charge`/SEZ candidates only (a
 * template's `name` is used verbatim for those non-standard flows).
 */
export function resolveTaxTemplate(
  templates: readonly TaxTemplate[],
  ctx: TaxContext,
): Resolution<TaxTemplate> {
  if (templates.length === 0) return { status: "hidden" };
  if (!ctx.party || !ctx.item) return { status: "hidden" };

  // Unregistered party or composition dealer → no GST at all, template not needed
  if (ctx.party.gst_treatment === "unregistered" || ctx.party.gst_treatment === "composition") {
    return { status: "hidden" };
  }

  const isInterstate =
    !!ctx.companyStateCode &&
    !!ctx.party.state_code &&
    ctx.companyStateCode !== ctx.party.state_code;

  const sameSupply = templates.filter((t) => t.is_interstate === isInterstate);
  if (sameSupply.length === 0) return { status: "unresolved", candidates: [...templates] };

  // Tier 1: HSN prefix match
  const hsn = ctx.item.hsn_code?.trim() ?? "";
  if (hsn) {
    const hsnMatch = sameSupply.filter((t) => t.hsn_prefix && hsn.startsWith(t.hsn_prefix));
    if (hsnMatch.length === 1) return { status: "auto", value: hsnMatch[0] };
    if (hsnMatch.length > 1) return { status: "ambiguous", candidates: hsnMatch };
  }

  // Tier 2: gst_rate match
  const rate = ctx.item.gst_rate;
  if (rate != null) {
    const rateMatch = sameSupply.filter(
      (t) => Math.abs(t.gst_rate - rate) < 0.001 && !t.is_reverse_charge,
    );
    if (rateMatch.length === 1) return { status: "auto", value: rateMatch[0] };
    if (rateMatch.length > 1) return { status: "ambiguous", candidates: rateMatch };
  }

  return { status: "unresolved", candidates: [...sameSupply] };
}

// -------------------------------------------------------------------------
// 3. Bill-wise allocation gate
// -------------------------------------------------------------------------

export interface BillAllocationContext {
  outstandingBillCount: number;
  voucherType: string;
}

/** Return true only when the bill-wise popup should surface automatically. */
export function shouldPromptBillAllocation(ctx: BillAllocationContext): boolean {
  if (ctx.outstandingBillCount > 0) return true;
  return ctx.voucherType === "credit_note" || ctx.voucherType === "debit_note";
}

// -------------------------------------------------------------------------
// 4. Transport / e-way bill auto-open threshold
// -------------------------------------------------------------------------

/** Default all-India threshold. Company settings can override per state. */
export const DEFAULT_EWAYBILL_THRESHOLD_PAISE = 50_000_00;

export function shouldAutoOpenTransportPanel(
  invoiceTotalPaise: number,
  thresholdPaise = DEFAULT_EWAYBILL_THRESHOLD_PAISE,
): boolean {
  return invoiceTotalPaise >= thresholdPaise;
}

// -------------------------------------------------------------------------
// 5. Cost centre gate
// -------------------------------------------------------------------------

export interface CostCentreContext {
  enabledForCompany: boolean;
  enabledForVoucherType?: boolean; // optional per-type override
}
export function shouldShowCostCentre(ctx: CostCentreContext): boolean {
  if (!ctx.enabledForCompany) return false;
  return ctx.enabledForVoucherType !== false;
}

// -------------------------------------------------------------------------
// 6. Batch / serial / alt-unit column gates (per-item, per-column)
// -------------------------------------------------------------------------

export interface ItemCapabilities {
  batch_tracked: boolean;
  serial_tracked: boolean;
  alt_unit: string | null;
}

/** Show the batch column when ANY row's item has batch tracking. */
export function shouldShowBatchColumn(items: readonly ItemCapabilities[]): boolean {
  return items.some((i) => i.batch_tracked);
}
export function shouldShowSerialColumn(items: readonly ItemCapabilities[]): boolean {
  return items.some((i) => i.serial_tracked);
}
export function shouldShowAltUnitColumn(items: readonly ItemCapabilities[]): boolean {
  return items.some((i) => !!i.alt_unit);
}
