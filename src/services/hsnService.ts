// Thin service layer over hsnRepository — gives UI a stable shape for
// auto-population and an explicit "not found" signal for inline warnings.
//
// Adds an IN-MEMORY FALLBACK: when the native SQLite store is unavailable
// (e.g. web preview where Tauri isn't running), we still resolve HSN codes
// from the static seed dataset so the dropdown + auto-fill keep working.

import { findHsnByCode, searchHsn, upsertHsn, type HsnRecord } from "@/repositories/hsnRepository";
import { HSN_MASTER_DATASET } from "@/lib/hsn/seedHsnData";

function seedToRecord(s: { code: string; desc: string; cgst: number; sgst: number; igst: number }): HsnRecord {
  return {
    hsn_code: s.code,
    description: s.desc,
    cgst_rate: s.cgst,
    sgst_rate: s.sgst,
    igst_rate: s.igst,
    is_exempt: s.igst === 0,
  };
}

function memoryFindByCode(code: string): HsnRecord | null {
  const c = code.trim();
  // exact, then longest prefix match (e.g. "4802" finds "48025410")
  const exact = HSN_MASTER_DATASET.find((s) => s.code === c);
  if (exact) return seedToRecord(exact);
  const prefix = HSN_MASTER_DATASET.find((s) => s.code.startsWith(c));
  return prefix ? seedToRecord(prefix) : null;
}

function memorySearch(prefix: string, limit: number): HsnRecord[] {
  const p = prefix.trim();
  const isNumeric = /^[0-9]+$/.test(p);
  const matches = isNumeric
    ? HSN_MASTER_DATASET.filter((s) => s.code.startsWith(p))
    : HSN_MASTER_DATASET.filter((s) => s.desc.toLowerCase().includes(p.toLowerCase()));
  return matches.slice(0, limit).map(seedToRecord);
}

export interface HsnLookup {
  found: boolean;
  record: HsnRecord | null;
}

export async function lookupHsn(code: string): Promise<HsnLookup> {
  const trimmed = (code || "").trim();
  if (!trimmed) return { found: false, record: null };
  try {
    const rec = await findHsnByCode(trimmed);
    if (rec) return { found: true, record: rec };
  } catch {
    /* fall through to memory */
  }
  const mem = memoryFindByCode(trimmed);
  return { found: !!mem, record: mem };
}

export async function suggestHsn(prefix: string, limit = 10): Promise<HsnRecord[]> {
  const p = (prefix || "").trim();
  if (!p) return [];
  try {
    const rows = await searchHsn(p, limit);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through to memory */
  }
  return memorySearch(p, limit);
}

export async function saveHsn(rec: HsnRecord): Promise<{ ok: boolean; error?: string }> {
  return upsertHsn(rec);
}

export type { HsnRecord };
