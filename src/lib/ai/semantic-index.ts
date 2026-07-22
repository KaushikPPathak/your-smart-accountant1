// Local, fully-offline semantic index over ledgers, parties, and items.
//
// Uses a lightweight token-hashing embedding (bag-of-trigrams + word-shingles)
// so we don't ship a heavy ML model. This is not SOTA embeddings — it's a
// deterministic, dependency-free vector that catches typos, transliteration,
// and word order, which is what accounting name-lookup actually needs.
//
// PERSISTENCE (Phase 3, step 3):
// The built index is mirrored into IndexedDB (`meta` table) so cold starts
// on large books (50k+ ledgers) don't pay the rebuild cost every launch.
// A `signature` (doc count + max updated_at) is stored alongside the vectors;
// on load we compare against the current masters and rebuild only when the
// signature drifts, or when the caller subscribes to `onDataChange`.

import { readItems, readLedgers } from "@/lib/offline/cache-read";
import { getMeta, setMeta } from "@/lib/offline/db";
import { onDataChange } from "./cache-events";

const INDEX_VERSION = 2; // bump when vectorizer or serialisation changes
const DIM = 256;
const META_KEY = (companyId: string) => `semantic_index:${companyId}`;

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
  signature: string;
  docs: IndexedDoc[];
}

interface PersistedIndex {
  version: number;
  builtAt: number;
  signature: string;
  dim: number;
  docs: Array<{
    id: string;
    kind: IndexedDoc["kind"];
    name: string;
    group?: string;
    /** base64-encoded Float32Array buffer */
    vec: string;
  }>;
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

// --------- serialisation -----------------------------------------------------

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  // btoa is available in browser + Tauri webview
  return typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function serialise(idx: CompanyIndex): PersistedIndex {
  return {
    version: idx.version,
    builtAt: idx.builtAt,
    signature: idx.signature,
    dim: DIM,
    docs: idx.docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      group: d.group,
      vec: bufToB64(d.vec.buffer as ArrayBuffer),
    })),
  };
}

function deserialise(p: PersistedIndex): CompanyIndex | null {
  if (p.version !== INDEX_VERSION || p.dim !== DIM) return null;
  return {
    version: p.version,
    builtAt: p.builtAt,
    signature: p.signature,
    docs: p.docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      group: d.group,
      vec: new Float32Array(b64ToBuf(d.vec)),
    })),
  };
}

// --------- index build / query ----------------------------------------------

function computeSignature(rows: Array<{ updated_at?: unknown }>): string {
  let maxU = "";
  for (const r of rows) {
    const u = String(r.updated_at ?? "");
    if (u > maxU) maxU = u;
  }
  return `${rows.length}|${maxU}`;
}

async function buildIndex(companyId: string): Promise<CompanyIndex> {
  const [ledgers, items] = await Promise.all([
    readLedgers(companyId),
    readItems(companyId),
  ]);
  const all = [...(ledgers as any[]), ...(items as any[])];
  const signature = computeSignature(all);
  const docs: IndexedDoc[] = [];
  for (const l of (ledgers as any[])) {
    const kind: IndexedDoc["kind"] = /debtor|creditor|sundry/i.test(String(l.group_name ?? "")) ? "party" : "ledger";
    const text = `${l.name} ${l.group_name ?? ""}`;
    docs.push({ id: String(l.id), kind, name: String(l.name ?? ""), group: l.group_name, vec: embed(text) });
  }
  for (const i of (items as any[])) {
    docs.push({ id: String(i.id), kind: "item", name: String(i.name ?? ""), vec: embed(String(i.name ?? "")) });
  }
  return { version: INDEX_VERSION, builtAt: Date.now(), signature, docs };
}

async function currentSignature(companyId: string): Promise<string> {
  const [ledgers, items] = await Promise.all([
    readLedgers(companyId),
    readItems(companyId),
  ]);
  return computeSignature([...(ledgers as any[]), ...(items as any[])]);
}

async function loadPersisted(companyId: string): Promise<CompanyIndex | null> {
  try {
    const raw = await getMeta<PersistedIndex>(META_KEY(companyId));
    if (!raw) return null;
    return deserialise(raw);
  } catch {
    return null;
  }
}

async function savePersisted(companyId: string, idx: CompanyIndex): Promise<void> {
  try {
    await setMeta(META_KEY(companyId), serialise(idx));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

export async function getIndex(companyId: string): Promise<CompanyIndex> {
  const cached = CACHE.get(companyId);
  if (cached && cached.version === INDEX_VERSION) return cached;

  // Try disk before rebuilding.
  const persisted = await loadPersisted(companyId);
  if (persisted) {
    const sig = await currentSignature(companyId);
    if (sig === persisted.signature) {
      CACHE.set(companyId, persisted);
      return persisted;
    }
  }

  const built = await buildIndex(companyId);
  CACHE.set(companyId, built);
  // Save asynchronously; don't block callers.
  void savePersisted(companyId, built);
  return built;
}

export function invalidateSemanticIndex(companyId?: string) {
  if (companyId) {
    CACHE.delete(companyId);
    void setMeta(META_KEY(companyId), undefined);
  } else {
    CACHE.clear();
  }
}

// Auto-invalidate on relevant master changes.
onDataChange((e) => {
  if (e.kind === "ledger" || e.kind === "item") {
    invalidateSemanticIndex(e.companyId);
  }
});

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
