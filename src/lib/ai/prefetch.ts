// Phase I — speculative prefetch.
//
// While the user is still typing a question we (a) classify the intent and
// (b) warm the retrieval slice it will need, off the critical path. When
// Enter is finally pressed the heavy local work (IndexedDB reads, semantic
// index hydration, balance math) is usually already done, so perceived
// latency collapses to the network round-trip alone.
//
// Everything is local-only and idempotent — a wasted speculation costs a
// few ms of idle CPU and nothing else.

import { routeQuery } from "./query-router";
import { retrieveForQuery, type RetrievedSlice } from "./retrievers";
import { semanticSearch } from "./semantic-index";

interface Speculation {
  key: string;
  routed: any;

  promise: Promise<RetrievedSlice | null>;
  at: number;
}

const TTL_MS = 60_000;
let current: Speculation | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function keyOf(companyId: string | null | undefined, text: string): string {
  return `${companyId ?? "-"}::${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function idle(fn: () => void) {
  const ric = (globalThis as any).requestIdleCallback as
    | ((cb: () => void, o?: { timeout: number }) => number)
    | undefined;
  if (ric) ric(fn, { timeout: 500 });
  else setTimeout(fn, 0);
}

/** Should we bother speculating on this partial text? */
function worthSpeculating(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  // Only for question-shaped input — avoids firing on voucher commands.
  return /\b(balance|ledger|outstanding|sales|purchase|stock|gst|trial|profit|cash|bank|show|what|how much|list)\b/i.test(t);
}

/**
 * Called (debounced) as the user types. Kicks off routing + retrieval for
 * the draft question. Safe to call on every keystroke.
 */
export function speculate(companyId: string | null | undefined, draft: string, delayMs = 350): void {
  if (!worthSpeculating(draft)) return;
  const key = keyOf(companyId, draft);
  if (current && current.key === key) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    idle(() => {
      const routed = routeQuery(draft);
      const promise = (async () => {
        try {
          // Warm the vector index too — first query on a cold index is the
          // expensive one.
          if (companyId && routed.entityHints.length) {
            void semanticSearch(companyId, routed.entityHints.join(" "), { k: 5 }).catch(() => []);
          }
          return await retrieveForQuery(routed, companyId ?? null);
        } catch {
          return null;
        }
      })();
      current = { key, routed, promise, at: Date.now() };
    });
  }, delayMs);
}

/**
 * On submit: return the in-flight/completed speculation for this exact
 * question, or null. Consumed once.
 */
export async function takeSpeculation(
  companyId: string | null | undefined,
  text: string,
): Promise<{ routed: any; slice: RetrievedSlice | null } | null> {
  const spec = current;
  if (!spec) return null;
  if (spec.key !== keyOf(companyId, text)) return null;
  if (Date.now() - spec.at > TTL_MS) {
    current = null;
    return null;
  }
  current = null;
  const slice = await spec.promise;
  return { routed: spec.routed, slice };
}

export function clearSpeculation(): void {
  current = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
