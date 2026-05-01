// Pure-offline intent matcher for the in-app assistant.
// Combines token overlap + Damerau–Levenshtein similarity (reused from
// tally-busy-import) so it tolerates typos and word reordering.

import { ASSISTANT_KB, type KbEntry } from "./assistant-knowledge";
import { normalizeName, similarity } from "./tally-busy-import";

export interface MatchResult {
  entry: KbEntry;
  score: number;
}

function tokensOf(s: string): string[] {
  return normalizeName(s).split(" ").filter((t) => t.length > 1);
}

/** Score a query against a single KB entry. */
function scoreEntry(query: string, entry: KbEntry): number {
  const qTokens = new Set(tokensOf(query));
  if (qTokens.size === 0) return 0;

  // 1) Keyword phrase boost: if a full keyword appears as substring, big bump.
  const qNorm = normalizeName(query);
  let phraseHit = 0;
  for (const k of entry.keywords) {
    const kn = normalizeName(k);
    if (!kn) continue;
    if (qNorm.includes(kn)) phraseHit = Math.max(phraseHit, 0.85);
  }

  // 2) Token overlap across keywords + title.
  const corpus = [entry.title, ...entry.keywords].join(" ");
  const cTokens = new Set(tokensOf(corpus));
  let overlap = 0;
  for (const t of qTokens) if (cTokens.has(t)) overlap++;
  const jaccardish = overlap / qTokens.size;

  // 3) Best fuzzy similarity per keyword (handles typos like "ledjer" → "ledger").
  let bestFuzzy = 0;
  for (const k of entry.keywords) {
    const s = similarity(query, k);
    if (s > bestFuzzy) bestFuzzy = s;
  }

  return Math.max(phraseHit, 0.55 * jaccardish + 0.45 * bestFuzzy);
}

/** Return the top N entries above a threshold, sorted by score desc. */
export function searchKb(query: string, opts?: { limit?: number; threshold?: number }): MatchResult[] {
  const limit = opts?.limit ?? 4;
  const threshold = opts?.threshold ?? 0.32;
  const results: MatchResult[] = [];
  for (const entry of ASSISTANT_KB) {
    const score = scoreEntry(query, entry);
    if (score >= threshold) results.push({ entry, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
