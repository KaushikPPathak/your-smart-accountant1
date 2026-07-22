// Answer cache — stores AI answers keyed by (company, intent, scope, question).
//
// Backed by localStorage with a hard cap + LRU eviction. Cache entries are
// invalidated whenever the underlying data mutates: writers should call
// `invalidateAnswerCache(companyId)` after any voucher/ledger/item write.

const STORAGE_KEY = "ym_ai_answer_cache_v1";
const MAX_ENTRIES = 200;
const TTL_MS = 1000 * 60 * 60 * 6; // 6h hard TTL as a safety net

interface CacheEntry {
  key: string;
  companyId: string;
  intent: string;
  scope: string;
  question: string;
  answer: string;
  createdAt: number;
  lastUsed: number;
}

function loadAll(): CacheEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveAll(entries: CacheEntry[]) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
}

function hashKey(companyId: string, intent: string, scope: string, question: string): string {
  const s = `${companyId}|${intent}|${scope}|${question.toLowerCase().replace(/\s+/g, " ").trim()}`;
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function lookupAnswer(
  companyId: string, intent: string, scope: string, question: string,
): string | null {
  const key = hashKey(companyId, intent, scope, question);
  const all = loadAll();
  const hit = all.find((e) => e.key === key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > TTL_MS) {
    saveAll(all.filter((e) => e.key !== key));
    return null;
  }
  hit.lastUsed = Date.now();
  saveAll(all);
  return hit.answer;
}

export function storeAnswer(
  companyId: string, intent: string, scope: string, question: string, answer: string,
) {
  if (!answer || answer.length < 4) return;
  const key = hashKey(companyId, intent, scope, question);
  const now = Date.now();
  const all = loadAll().filter((e) => e.key !== key);
  all.push({ key, companyId, intent, scope, question, answer, createdAt: now, lastUsed: now });
  if (all.length > MAX_ENTRIES) {
    all.sort((a, b) => b.lastUsed - a.lastUsed);
    all.length = MAX_ENTRIES;
  }
  saveAll(all);
}

export function invalidateAnswerCache(companyId?: string) {
  if (!companyId) { saveAll([]); return; }
  saveAll(loadAll().filter((e) => e.companyId !== companyId));
}

export function answerCacheStats(): { entries: number; companies: number; oldestAgeMs: number } {
  const all = loadAll();
  const oldest = all.reduce((m, e) => Math.min(m, e.createdAt), Date.now());
  return {
    entries: all.length,
    companies: new Set(all.map((e) => e.companyId)).size,
    oldestAgeMs: Date.now() - oldest,
  };
}
