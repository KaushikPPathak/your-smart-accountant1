// Phase I — approximate nearest-neighbour index for the local semantic corpus.
//
// Why not sqlite-vss / hnswlib-wasm?
//   Both ship a multi-MB WASM binary and need SIMD / recent V8 — the Win-7
//   legacy Electron 22 build cannot load them reliably, and the corpus here
//   (ledgers + parties + items) is tens of thousands of rows, not millions.
//
// Instead this is a dependency-free random-hyperplane LSH (signed random
// projection) index: O(1) bucket lookup + a small candidate rescore, versus
// the previous O(n) cosine scan over every doc. Recall is kept high by
// using several independent tables and probing 1-bit-flip neighbour buckets.
//
// Deterministic seeds ⇒ the index is reproducible and can be rebuilt from
// persisted vectors without storing the planes.

const TABLES = 6; // independent hash tables
const BITS = 12; // bits per table → up to 4096 buckets/table

/** Corpus size below which a plain linear scan is simply faster. */
export const ANN_MIN_DOCS = 400;

/** xorshift32 — deterministic, tiny, good enough for random planes. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

function makePlanes(dim: number): Float32Array[] {
  const next = rng(0x5eed1234);
  const planes: Float32Array[] = [];
  for (let t = 0; t < TABLES * BITS; t++) {
    const p = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      // Box–Muller-ish: uniform in [-1,1) is fine for hyperplane signs.
      p[i] = next() * 2 - 1;
    }
    planes.push(p);
  }
  return planes;
}

const PLANE_CACHE = new Map<number, Float32Array[]>();
function planesFor(dim: number): Float32Array[] {
  let p = PLANE_CACHE.get(dim);
  if (!p) {
    p = makePlanes(dim);
    PLANE_CACHE.set(dim, p);
  }
  return p;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Signature of a vector: one integer key per table. */
function signatures(vec: Float32Array): number[] {
  const planes = planesFor(vec.length);
  const keys: number[] = [];
  for (let t = 0; t < TABLES; t++) {
    let key = 0;
    for (let b = 0; b < BITS; b++) {
      if (dot(vec, planes[t * BITS + b]) >= 0) key |= 1 << b;
    }
    keys.push(key);
  }
  return keys;
}

export interface AnnIndex {
  dim: number;
  /** table → bucket key → doc ids */
  tables: Array<Map<number, string[]>>;
  /** doc id → its per-table bucket keys (needed for removal) */
  keysById: Map<string, number[]>;
  size: number;
}

export function createAnn(dim: number): AnnIndex {
  return {
    dim,
    tables: Array.from({ length: TABLES }, () => new Map<number, string[]>()),
    keysById: new Map(),
    size: 0,
  };
}

export function annAdd(idx: AnnIndex, id: string, vec: Float32Array): void {
  if (idx.keysById.has(id)) annRemove(idx, id);
  const keys = signatures(vec);
  for (let t = 0; t < TABLES; t++) {
    const bucket = idx.tables[t].get(keys[t]);
    if (bucket) bucket.push(id);
    else idx.tables[t].set(keys[t], [id]);
  }
  idx.keysById.set(id, keys);
  idx.size++;
}

export function annRemove(idx: AnnIndex, id: string): void {
  const keys = idx.keysById.get(id);
  if (!keys) return;
  for (let t = 0; t < TABLES; t++) {
    const bucket = idx.tables[t].get(keys[t]);
    if (!bucket) continue;
    const at = bucket.indexOf(id);
    if (at >= 0) bucket.splice(at, 1);
    if (bucket.length === 0) idx.tables[t].delete(keys[t]);
  }
  idx.keysById.delete(id);
  idx.size--;
}

export function annBuild(dim: number, docs: Array<{ id: string; vec: Float32Array }>): AnnIndex {
  const idx = createAnn(dim);
  for (const d of docs) annAdd(idx, d.id, d.vec);
  return idx;
}

/**
 * Candidate doc ids for a query vector. Probes the exact bucket in every
 * table plus every 1-bit-flip neighbour (cheap extra recall).
 * Returns null when the candidate set looks too thin to trust — the caller
 * should fall back to a linear scan in that case.
 */
export function annCandidates(idx: AnnIndex, vec: Float32Array, want: number): Set<string> | null {
  const keys = signatures(vec);
  const out = new Set<string>();
  for (let t = 0; t < TABLES; t++) {
    const table = idx.tables[t];
    const exact = table.get(keys[t]);
    if (exact) for (const id of exact) out.add(id);
    for (let b = 0; b < BITS; b++) {
      const neighbour = table.get(keys[t] ^ (1 << b));
      if (neighbour) for (const id of neighbour) out.add(id);
    }
  }
  if (out.size < Math.min(idx.size, want * 4)) return null;
  return out;
}
