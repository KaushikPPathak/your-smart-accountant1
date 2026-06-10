// Thin service layer over hsnRepository — gives UI a stable shape for
// auto-population and an explicit "not found" signal for inline warnings.

import { findHsnByCode, searchHsn, upsertHsn, type HsnRecord } from "@/repositories/hsnRepository";

export interface HsnLookup {
  found: boolean;
  record: HsnRecord | null;
}

export async function lookupHsn(code: string): Promise<HsnLookup> {
  const trimmed = (code || "").trim();
  if (!trimmed) return { found: false, record: null };
  const rec = await findHsnByCode(trimmed);
  return { found: !!rec, record: rec };
}

export async function suggestHsn(prefix: string, limit = 10): Promise<HsnRecord[]> {
  const p = (prefix || "").trim();
  if (!p) return [];
  return searchHsn(p, limit);
}

export async function saveHsn(rec: HsnRecord): Promise<{ ok: boolean; error?: string }> {
  return upsertHsn(rec);
}

export type { HsnRecord };
