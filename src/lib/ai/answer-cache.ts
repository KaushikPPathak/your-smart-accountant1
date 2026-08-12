// Answer cache — stores AI answers keyed by (company, intent, scope, question).
//
// Each entry carries `tags` describing which intents/scopes it depends on.
// When a data-change event fires (voucher/ledger/item write), only matching
// entries are dropped — the rest stay hot. This is the Smart Invalidation
// layer: fresh answers without a blanket cache wipe.

import { INTENT_DEPS, onDataChange, type DataChangeEvent } from "./cache-events";

const STORAGE_KEY = "ym_ai_answer_cache_v2";
const MAX_ENTRIES = 200;
const TTL_MS = 1000 * 60 * 60 * 6; // 6h hard TTL as a safety net

interface CacheEntry {
  key: string;
  companyId: string;
  intent: string;
  scope: string;
  question: string;
  answer: string;
  tags: string[];
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

/** Derive dependency tags from the intent + scope so writers can target them. */
function deriveTags(intent: string, scope: string): string[] {
  const tags = new Set<string>();
  tags.add(`intent:${intent}`);
  // Scope hints like "party:Ramesh & Co" or "period:2025-Q3" — split on commas.
  for (const part of scope.split(/[,;]+/)) {
    const t = part.trim().toLowerCase();
    if (t) tags.add(t);
  }
  return [...tags];
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
  all.push({
    key, companyId, intent, scope, question, answer,
    tags: deriveTags(intent, scope),
    createdAt: now, lastUsed: now,
  });
  if (all.length > MAX_ENTRIES) {
    all.sort((a, b) => b.lastUsed - a.lastUsed);
    all.length = MAX_ENTRIES;
  }
  saveAll(all);
}

/** Nuke everything (or one company). Kept for restore / manual reset. */
export function invalidateAnswerCache(companyId?: string) {
  if (!companyId) { saveAll([]); return; }
  saveAll(loadAll().filter((e) => e.companyId !== companyId));
}

/** Drop entries whose tags intersect any of the given tags for a company. */
export function invalidateByTags(companyId: string, tags: string[]): number {
  if (!companyId || tags.length === 0) return 0;
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  const all = loadAll();
  let dropped = 0;
  const kept = all.filter((e) => {
    if (e.companyId !== companyId) return true;
    const hit = e.tags.some((t) => wanted.has(t.toLowerCase()));
    if (hit) { dropped++; return false; }
    return true;
  });
  if (dropped > 0) saveAll(kept);
  return dropped;
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

// --- Wire cache to data-change bus (module-load side effect, idempotent) ----

let wired = false;
function wireInvalidation() {
  if (wired) return;
  wired = true;
  onDataChange((evt: DataChangeEvent) => {
    const intentTags = (INTENT_DEPS[evt.kind] ?? []).map((i) => `intent:${i}`);
    const scopeTags = (evt.scopes ?? []).map((s) => s.toLowerCase());
    invalidateByTags(evt.companyId, [...intentTags, ...scopeTags]);
  });
}
wireInvalidation();
