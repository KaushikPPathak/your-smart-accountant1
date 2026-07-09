// Self-healing normalizers for rows read from the Dexie cache.
//
// The cache is a mirror of Supabase rows written under whatever schema
// existed at the time. When we add a new column later, old rows in
// IndexedDB simply omit that key — spreading them over defaults leaves
// the field silently at its default (`false`, `null`, `0`) even when the
// server-side truth is different. That is the root cause of an entire
// class of "menu missing / field empty / picker blank" bugs we saw
// after schema migrations.
//
// The fix: every read goes through a normalizer that fills in the
// derived-or-default value. Old rows heal on next read. When a new
// field is added later, add one line here and every existing cached
// row self-repairs.

import { GST_STATE_CODES } from "@/utils/stateCodes";

type AnyRow = Record<string, unknown>;

/** GSTIN's first two chars = state code. Safe fallback when the row omits state_code. */
function deriveStateCodeFromGstin(gstin: unknown): string | null {
  if (typeof gstin !== "string" || gstin.length < 2) return null;
  const prefix = gstin.slice(0, 2);
  return GST_STATE_CODES[prefix] ? prefix : null;
}

/** Normalize a `cache_companies` row. Idempotent. */
export function normalizeCompany<T extends AnyRow>(row: T | null | undefined): T | null {
  if (!row || typeof row !== "object") return null;
  const out: AnyRow = { ...row };

  // If a GSTIN was ever captured, the company is by definition GST-registered.
  if (out.gstin && !out.gst_registered) out.gst_registered = true;
  if (out.gst_registered == null) out.gst_registered = false;

  if (out.inventory_enabled == null) out.inventory_enabled = true;
  if (out.gst_filing_frequency == null) out.gst_filing_frequency = "monthly";
  if (out.entity_status == null) out.entity_status = "individual";
  if (out.currency_code == null) out.currency_code = "INR";
  if (out.date_format == null) out.date_format = "dd-mm-yyyy";
  if (out.mode == null) out.mode = "normal";
  if (out.annual_turnover_paise == null) out.annual_turnover_paise = 0;
  if (out.share_capital_paise == null) out.share_capital_paise = 0;
  if (out.corpus_fund_paise == null) out.corpus_fund_paise = 0;

  if (!out.state_code) {
    const derived = deriveStateCodeFromGstin(out.gstin);
    if (derived) out.state_code = derived;
  }
  if (!out.financial_year_start) {
    const y = new Date().getFullYear();
    const cy = new Date().getMonth() < 3 ? y - 1 : y;
    out.financial_year_start = `${cy}-04-01`;
  }
  return out as T;
}

/** Normalize a `cache_ledgers` row. */
export function normalizeLedger<T extends AnyRow>(row: T | null | undefined): T | null {
  if (!row || typeof row !== "object") return null;
  const out: AnyRow = { ...row };
  if (out.is_active == null) out.is_active = true;
  if (out.is_deleted == null) out.is_deleted = false;
  if (out.opening_balance_paise == null) out.opening_balance_paise = 0;
  if (out.gst_treatment == null && out.gstin) out.gst_treatment = "regular";
  return out as T;
}

/** Normalize a `cache_items` row. */
export function normalizeItem<T extends AnyRow>(row: T | null | undefined): T | null {
  if (!row || typeof row !== "object") return null;
  const out: AnyRow = { ...row };
  if (out.is_active == null) out.is_active = true;
  if (out.is_deleted == null) out.is_deleted = false;
  if (out.gst_rate == null) out.gst_rate = 0;
  if (out.opening_qty == null) out.opening_qty = 0;
  if (out.opening_value_paise == null) out.opening_value_paise = 0;
  if (out.unit == null) out.unit = "NOS";
  return out as T;
}

/** Normalize a `cache_vouchers` row. */
export function normalizeVoucher<T extends AnyRow>(row: T | null | undefined): T | null {
  if (!row || typeof row !== "object") return null;
  const out: AnyRow = { ...row };
  if (out.is_deleted == null) out.is_deleted = false;
  if (out.total_amount_paise == null) out.total_amount_paise = 0;
  return out as T;
}

/** Batch helper. Drops nulls (rows too malformed to salvage). */
export function normalizeAll<T extends AnyRow>(
  rows: readonly T[] | null | undefined,
  fn: (r: T) => T | null,
): T[] {
  if (!rows) return [];
  const out: T[] = [];
  for (const r of rows) {
    const n = fn(r);
    if (n) out.push(n);
  }
  return out;
}
