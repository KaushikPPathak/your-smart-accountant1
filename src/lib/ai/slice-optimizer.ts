// Smart Optimization (Phase 3, step 4).
//
// Trims a RetrievedSlice before it leaves the device so the LLM prompt is
// as small as possible without losing signal:
//
//  1. Column pruning     — drop null / undefined / "" / empty-object fields.
//  2. Zero-value pruning — drop numeric paise fields whose value is exactly 0.
//  3. Array capping      — cap each array at MAX_ROWS with a "_more" marker.
//  4. Paise → rupees     — collapse *_paise fields to a compact `<key>_rs`
//                          rupees value (2 dp), which halves digit count.
//  5. ID trimming        — long UUIDs become their first 8 chars; the CCR
//                          cache still holds the full row keyed by hash.
//
// The optimizer is intentionally conservative: anything the LLM might need
// for a citation (voucher_number, voucher_date, ledger name, fact keys) is
// preserved verbatim.

import type { RetrievedSlice } from "./retrievers";

const MAX_ROWS_PER_ARRAY = 60;
const CITATION_KEEP = new Set([
  "id", "voucher_number", "voucher_date", "date", "name", "party", "group",
  "voucher_type", "kind", "unit", "place_of_supply",
]);

function shortId(v: unknown): unknown {
  if (typeof v !== "string") return v;
  // UUID-ish? Keep the last 8 chars — enough to disambiguate in a slice.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return v.slice(-8);
  }
  return v;
}

function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && v !== null && Object.keys(v as object).length === 0) return true;
  return false;
}

function pruneObject(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isEmpty(v)) continue;

    // Paise → rupees rewrite.
    if (k.endsWith("_paise") && typeof v === "number") {
      if (v === 0) continue;
      const newKey = k.slice(0, -"_paise".length) + "_rs";
      out[newKey] = paiseToRupees(v);
      continue;
    }

    if (k === "id" || k.endsWith("_id")) {
      out[k] = shortId(v);
      continue;
    }

    if (Array.isArray(v)) {
      out[k] = capAndPrune(v);
      continue;
    }

    if (typeof v === "object" && v !== null) {
      const nested = pruneObject(v as Record<string, unknown>);
      if (Object.keys(nested).length > 0) out[k] = nested;
      continue;
    }

    // Numbers of 0 that aren't paise: keep if the key looks like a citation
    // hint (count, qty), else drop.
    if (typeof v === "number" && v === 0 && !CITATION_KEEP.has(k)) continue;

    out[k] = v;
  }
  return out;
}

function capAndPrune(rows: unknown[]): unknown[] {
  const capped = rows.length > MAX_ROWS_PER_ARRAY ? rows.slice(0, MAX_ROWS_PER_ARRAY) : rows;
  const cleaned = capped.map((r) =>
    r && typeof r === "object" && !Array.isArray(r)
      ? pruneObject(r as Record<string, unknown>)
      : r,
  );
  if (rows.length > MAX_ROWS_PER_ARRAY) {
    cleaned.push({ _more: rows.length - MAX_ROWS_PER_ARRAY });
  }
  return cleaned;
}

/** Return a token-optimised copy of the slice — original is untouched. */
export function optimiseSlice(slice: RetrievedSlice): RetrievedSlice {
  const data: Record<string, unknown[]> = {};
  for (const [key, rows] of Object.entries(slice.data)) {
    if (!Array.isArray(rows)) continue;
    data[key] = capAndPrune(rows);
  }
  const facts = slice.facts
    ? pruneObject(slice.facts as Record<string, unknown>)
    : undefined;
  return { scope: slice.scope, data, facts };
}
