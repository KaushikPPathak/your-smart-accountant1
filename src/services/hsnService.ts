// Thin service layer over hsnRepository — gives UI a stable shape for
// auto-population and an explicit "not found" signal for inline warnings.
//
// Adds an IN-MEMORY FALLBACK: when the native SQLite store is unavailable
// (e.g. web preview where Tauri isn't running), we still resolve HSN codes
// from the static seed dataset so the dropdown + auto-fill keep working.
//
// The in-memory path is index-backed (built once, lazily) so typing in the
// autocomplete never scans the whole dataset:
//   - exact code lookup  -> Map hit
//   - prefix code lookup -> sorted code array + binary search on the range
//   - description search -> inverted word index (first 3 chars of each word)
// Recent queries are memoised in a small LRU so repeated keystrokes are free.

import { findHsnByCode, searchHsn, upsertHsn, type HsnRecord } from "@/repositories/hsnRepository";
import { HSN_MASTER_DATASET } from "@/lib/hsn/seedHsnData";

type Seed = { code: string; desc: string; cgst: number; sgst: number; igst: number };

function seedToRecord(s: Seed): HsnRecord {
  return {
    hsn_code: s.code,
    description: s.desc,
    cgst_rate: s.cgst,
    sgst_rate: s.sgst,
    igst_rate: s.igst,
    is_exempt: s.igst === 0,
  };
}

interface HsnIndex {
  byCode: Map<string, Seed>;
  sortedCodes: string[];
  codeToSeed: Map<string, Seed>;
  /** first-3-letters bucket -> seeds whose description contains a word starting with it */
  wordBuckets: Map<string, Seed[]>;
}

let _index: HsnIndex | null = null;

function buildIndex(): HsnIndex {
  const byCode = new Map<string, Seed>();
  const codeToSeed = new Map<string, Seed>();
  const wordBuckets = new Map<string, Seed[]>();

  for (const s of HSN_MASTER_DATASET as Seed[]) {
    const code = s.code.trim();
    if (!byCode.has(code)) byCode.set(code, s);
    codeToSeed.set(code.toLowerCase(), s);

    const words = s.desc.toLowerCase().split(/[^a-z0-9]+/);
    const seenBucket = new Set<string>();
    for (const w of words) {
      if (w.length < 2) continue;
      const key = w.slice(0, 3);
      if (seenBucket.has(key)) continue;
      seenBucket.add(key);
      const bucket = wordBuckets.get(key);
      if (bucket) bucket.push(s);
      else wordBuckets.set(key, [s]);
    }
  }

  const sortedCodes = [...codeToSeed.keys()].sort();
  return { byCode, sortedCodes, codeToSeed, wordBuckets };
}

function getIndex(): HsnIndex {
  if (!_index) _index = buildIndex();
  return _index;
}

/** First position in `arr` whose value is >= target. */
function lowerBound(arr: string[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function memoryFindByCode(code: string): HsnRecord | null {
  const idx = getIndex();
  const c = code.trim();
  const exact = idx.byCode.get(c);
  if (exact) return seedToRecord(exact);

  // longest-code-first behaviour preserved: first code in sorted order with the prefix
  const lower = c.toLowerCase();
  const start = lowerBound(idx.sortedCodes, lower);
  const hit = idx.sortedCodes[start];
  if (hit && hit.startsWith(lower)) {
    const seed = idx.codeToSeed.get(hit);
    return seed ? seedToRecord(seed) : null;
  }
  return null;
}

function memorySearch(prefix: string, limit: number): HsnRecord[] {
  const idx = getIndex();
  const q = prefix.trim().toLowerCase();
  if (!q) return [];

  const out: Seed[] = [];
  const taken = new Set<string>();

  // 1) code prefix matches, via the sorted code array
  for (let i = lowerBound(idx.sortedCodes, q); i < idx.sortedCodes.length; i++) {
    const code = idx.sortedCodes[i];
    if (!code.startsWith(q)) break;
    const seed = idx.codeToSeed.get(code);
    if (seed && !taken.has(seed.code)) {
      taken.add(seed.code);
      out.push(seed);
      if (out.length >= limit) return out.map(seedToRecord);
    }
  }

  // 2) description matches, restricted to the relevant word bucket
  const candidates =
    q.length >= 3
      ? idx.wordBuckets.get(q.slice(0, 3)) ?? []
      : [...idx.wordBuckets.values()].flat();

  for (const seed of candidates) {
    if (taken.has(seed.code)) continue;
    if (!seed.desc.toLowerCase().includes(q)) continue;
    taken.add(seed.code);
    out.push(seed);
    if (out.length >= limit) break;
  }

  return out.map(seedToRecord);
}

/** Tiny LRU so repeated keystrokes / re-renders don't recompute. */
const CACHE_LIMIT = 60;
const _searchCache = new Map<string, HsnRecord[]>();

function cachedMemorySearch(q: string, limit: number): HsnRecord[] {
  const key = `${limit}:${q.toLowerCase()}`;
  const hit = _searchCache.get(key);
  if (hit) {
    _searchCache.delete(key);
    _searchCache.set(key, hit);
    return hit;
  }
  const rows = memorySearch(q, limit);
  _searchCache.set(key, rows);
  if (_searchCache.size > CACHE_LIMIT) {
    const oldest = _searchCache.keys().next().value as string | undefined;
    if (oldest !== undefined) _searchCache.delete(oldest);
  }
  return rows;
}

export interface HsnLookup {
  found: boolean;
  record: HsnRecord | null;
}

export async function lookupHsn(code: string): Promise<HsnLookup> {
  const trimmed = (code || "").trim();
  if (!trimmed) return { found: false, record: null };

  // Memory index answers instantly; only fall back to SQLite for custom codes.
  const mem = memoryFindByCode(trimmed);
  if (mem) return { found: true, record: mem };

  try {
    const rec = await findHsnByCode(trimmed);
    if (rec) return { found: true, record: rec };
  } catch {
    /* ignore — memory already missed */
  }
  return { found: false, record: null };
}

export async function suggestHsn(prefix: string, limit = 10): Promise<HsnRecord[]> {
  const p = (prefix || "").trim();
  if (!p) return [];

  const mem = cachedMemorySearch(p, limit);
  if (mem.length >= limit) return mem;

  // Top up with anything extra stored locally (user-added codes).
  try {
    const rows = await searchHsn(p, limit);
    if (rows.length > 0) {
      const seen = new Set(mem.map((r) => r.hsn_code));
      const merged = [...mem];
      for (const r of rows) {
        if (seen.has(r.hsn_code)) continue;
        seen.add(r.hsn_code);
        merged.push(r);
        if (merged.length >= limit) break;
      }
      return merged;
    }
  } catch {
    /* memory results stand */
  }
  return mem;
}

export async function saveHsn(rec: HsnRecord): Promise<{ ok: boolean; error?: string }> {
  _searchCache.clear();
  return upsertHsn(rec);
}

export type { HsnRecord };
