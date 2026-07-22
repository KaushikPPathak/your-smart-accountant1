// Local, fully-offline semantic index over ledgers, parties, and items.
//
// Uses a lightweight token-hashing embedding (bag-of-trigrams + word-shingles)
// so we don't ship a heavy ML model. This is not SOTA embeddings — it's a
// deterministic, dependency-free vector that catches typos, transliteration,
// and word order, which is what accounting name-lookup actually needs.
//
// The index is rebuilt lazily per company and cached in memory. Bump
// INDEX_VERSION whenever the vectorizer changes so stale caches are dropped.

import { readItems, readLedgers } from "@/lib/offline/cache-read";

const INDEX_VERSION = 1;
const DIM = 256;

export interface IndexedDoc {
  id: string;
  kind: "ledger" | "party" | "item";
  name: string;
  group?: string;
  vec: Float32Array;
}

interface CompanyIndex {
  version: number;
  builtAt: number;
  docs: IndexedDoc[];
}

const CACHE = new Map<string, CompanyIndex>();

// --------- vectorizer --------------------------------------------------------

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  const norm = normalise(s);
  const words = norm.split(" ").filter(Boolean);
  const out: string[] = [...words];
  // char trigrams for typo tolerance
  const padded = ` ${norm} `;
  for (let i = 0; i < padded.length - 2; i++) out.push(padded.slice(i, i + 3));
  return out;
}

export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const t of tokens(text)) {
    const h = fnv1a(t);
    v[h % DIM] += 1;
    v[(h >>> 8) % DIM] += 0.5; // second hash reduces collision impact
  }
  // l2 normalise
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

// --------- index build / query ----------------------------------------------

async function buildIndex(companyId: string): Promise<CompanyIndex> {
  const [ledgers, items] = await Promise.all([
    readLedgers(companyId),
    readItems(companyId),
  ]);
  const docs: IndexedDoc[] = [];
  for (const l of (ledgers as any[])) {
    const kind: IndexedDoc["kind"] = /debtor|creditor|sundry/i.test(String(l.group_name ?? "")) ? "party" : "ledger";
    const text = `${l.name} ${l.group_name ?? ""}`;
    docs.push({ id: String(l.id), kind, name: String(l.name ?? ""), group: l.group_name, vec: embed(text) });
  }
  for (const i of (items as any[])) {
    docs.push({ id: String(i.id), kind: "item", name: String(i.name ?? ""), vec: embed(String(i.name ?? "")) });
  }
  return { version: INDEX_VERSION, builtAt: Date.now(), docs };
}

export async function getIndex(companyId: string): Promise<CompanyIndex> {
  const cached = CACHE.get(companyId);
  if (cached && cached.version === INDEX_VERSION) return cached;
  const built = await buildIndex(companyId);
  CACHE.set(companyId, built);
  return built;
}

export function invalidateSemanticIndex(companyId?: string) {
  if (companyId) CACHE.delete(companyId);
  else CACHE.clear();
}

export interface SemanticHit {
  id: string;
  kind: IndexedDoc["kind"];
  name: string;
  group?: string;
  score: number;
}

export async function semanticSearch(
  companyId: string,
  query: string,
  opts: { k?: number; kinds?: IndexedDoc["kind"][]; minScore?: number } = {},
): Promise<SemanticHit[]> {
  const k = opts.k ?? 8;
  const min = opts.minScore ?? 0.15;
  const idx = await getIndex(companyId);
  const q = embed(query);
  const scored: SemanticHit[] = [];
  for (const d of idx.docs) {
    if (opts.kinds && !opts.kinds.includes(d.kind)) continue;
    const s = cosine(q, d.vec);
    if (s >= min) scored.push({ id: d.id, kind: d.kind, name: d.name, group: d.group, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
