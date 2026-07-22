// Pulls accounting context from the local "brain" and runs it through the
// Data Minimization Layer (route → scoped retrieve → redact → compress) before
// handing it to the LLM.
//
// Every retrieved slice is also stashed in the CCR cache so the LLM can ask
// for the original rows back later via `retrieveOriginal`.

import { cacheRowsForCcr, compressMessages } from "./headroom";
import { routeQuery, type QueryIntent } from "./query-router";
import { retrieveForQuery, type RetrievedSlice } from "./retrievers";
import { optimiseSlice } from "./slice-optimizer";
import { createRedactionMap, redactDeep, unredact, type RedactionMap } from "./redactor";

export interface AccountingContext {
  companyId?: string;
  ledgers?: number;
  parties?: number;
  recentVouchers?: number;
}

export interface CompressedContext {
  systemMessage: { role: "system"; content: string };
  userMessage: { role: "user"; content: string };
  ccrHashes: Record<string, string>;
  compressed: boolean;
  /** Intent the router picked — surfaced for debugging / analytics. */
  intent: QueryIntent;
  /** Human-readable description of the slice we sent. */
  scope: string;
  /** Reverse-PII map. Keep it local and call `unredactAnswer` on the LLM reply. */
  redaction: RedactionMap;
}

function resolveContextCompanyId(explicitCompanyId?: string | null): string | null {
  if (explicitCompanyId) return explicitCompanyId;
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem("ym_active_company_id"); } catch { return null; }
}

/**
 * Build a compressed, PII-scrubbed context bundle for a user question.
 *
 * Pipeline: routeQuery → retrieveForQuery → redactDeep → cacheRowsForCcr →
 * Headroom compression. Only the minimum slice needed to answer the question
 * leaves the device, and PII (GSTIN/PAN/phone/email/bank a/c) is tokenised.
 */
export async function buildCompressedContext(userQuestion: string, companyId?: string | null): Promise<CompressedContext> {
  const routed = routeQuery(userQuestion);
  const slice: RetrievedSlice = await retrieveForQuery(routed, resolveContextCompanyId(companyId));

  const redaction = createRedactionMap();
  const safeData = redactDeep(slice.data, redaction);
  const safeFacts = slice.facts ? redactDeep(slice.facts, redaction) : undefined;

  const ccrHashes: Record<string, string> = {};
  for (const [key, rows] of Object.entries(safeData)) {
    if (Array.isArray(rows) && rows.length > 0) {
      ccrHashes[key] = cacheRowsForCcr(key, rows);
    }
  }

  const systemMessage = {
    role: "system" as const,
    content:
      "You are an accounting assistant. The user's question was classified as " +
      `intent="${routed.intent}" and only the relevant slice of their books ` +
      "is attached. PII (GSTIN, PAN, phone, email, bank a/c) has been replaced " +
      'with opaque tokens like "<GSTIN_a1b2>" — reference those tokens as-is; ' +
      "the client will substitute the real values before showing your answer. " +
      "If you need more rows than the attached slice, request them by calling " +
      'the `retrieveOriginal` tool with a matching hash from "ccrHashes". ' +
      "CITATIONS: every numeric claim you make MUST be followed by a citation " +
      'in the exact form [V:<voucher_number> <YYYY-MM-DD>] for a voucher, ' +
      '[L:<ledger name>] for a ledger, or [F:<fact key>] for a computed fact ' +
      'from the "facts" object. Do not cite anything not present in the payload.',
  };

  const userMessage = {
    role: "user" as const,
    content: JSON.stringify(
      {
        question: redactDeep(userQuestion, redaction),
        intent: routed.intent,
        scope: slice.scope,
        entityHints: routed.entityHints,
        dateRange: routed.from || routed.to ? { from: routed.from, to: routed.to } : undefined,
        facts: safeFacts,
        data: safeData,
        ccrHashes,
      },
      null,
      0,
    ),
  };

  const { messages, compressed } = await compressMessages([systemMessage, userMessage], {
    model: "local-webllm",
  });

  return {
    systemMessage: messages[0] as { role: "system"; content: string },
    userMessage: messages[1] as { role: "user"; content: string },
    ccrHashes,
    compressed,
    intent: routed.intent,
    scope: slice.scope,
    redaction,
  };
}

/** Convenience: un-tokenise the model's reply before rendering to the user. */
export function unredactAnswer(text: string, ctx: Pick<CompressedContext, "redaction">): string {
  return unredact(text, ctx.redaction);
}
