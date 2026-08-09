// Pulls accounting context from the local "brain" and runs it through the
// Data Minimization Layer (route → scoped retrieve → redact → compress) before
// handing it to the LLM.
//
// Every retrieved slice is also stashed in the CCR cache so the LLM can ask
// for the original rows back later via `retrieveOriginal`.

import { cacheRowsForCcr, compressMessages } from "./headroom";
import { routeQuery, type IntentType } from "./query-router";
import { retrieveForQuery, type RetrievedSlice } from "./retrievers";
import { takeSpeculation } from "./prefetch";
import { optimiseSlice } from "./slice-optimizer";
import { createRedactionMap, redactDeep, redactString, unredact, type RedactionMap } from "./redactor";
import type { ConversationMemory } from "./conversation-memory";
import { toolCatalogPrompt } from "./tools";
import { buildMemorySnapshot } from "./persistent-memory";

export interface AccountingContext {
  companyId?: string;
  ledgers?: number;
  parties?: number;
  recentVouchers?: number;
}

export type CardKind =
  | "party_balance"
  | "cash_balance"
  | "bank_balance"
  | "trial_balance"
  | "voucher_lookup"
  | "voucher_list";

/** Structured answer card — the deterministic "ground truth" the client
 *  renders alongside (and above) the model's prose commentary. Built from
 *  local aggregators, never from the LLM. */
export interface StructuredCard {
  kind: CardKind;
  companyName?: string | null;
  partyName?: string;
  partyGroup?: string | null;
  openingPaise?: number;
  debitPaise?: number;
  creditPaise?: number;
  closingPaise?: number;
  /** true if closing is Dr (net debit), false if Cr. */
  isDebit?: boolean;
  asOnDate?: string | null;
  modeSplit?: { cashPaise: number; bankPaise: number; otherPaise: number };
  voucherCount?: number;
  /** Drill-through: recent vouchers touching this party (id + display info). */
  recentVouchers?: { id: string; number: string; date: string; kind: string; totalPaise: number }[];
  /** Cash / bank / trial balance fields */
  accountName?: string;
  rows?: Array<{ name: string; debitPaise: number; creditPaise: number; closingPaise: number }>;
  /** Voucher lookup fields */
  voucher?: any;
  vouchers?: any[];
  totalPaise?: number;
}

export interface CompressedContext {
  systemMessage: { role: "system"; content: string };
  userMessage: { role: "user"; content: string };
  ccrHashes: Record<string, string>;
  compressed: boolean;
  /** Intent the router picked — surfaced for debugging / analytics. */
  intent: IntentType;
  /** Human-readable description of the slice we sent. */
  scope: string;
  /** Reverse-PII map. Keep it local and call `unredactAnswer` on the LLM reply. */
  redaction: RedactionMap;
  /** Deterministic answer card (rendered by the UI, verified against the model). */
  card?: StructuredCard;
  /** Memory update the caller should persist for the next turn. */
  memory: ConversationMemory;
}

/** Local shape that retrievers expect — mapped from your RouteResult. */
interface RoutedQuery {
  intent: IntentType;
  entityHints: string[];
  asOn?: string;
  from?: string;
  to?: string;
}

function resolveContextCompanyId(explicitCompanyId?: string | null): string | null {
  if (explicitCompanyId) return explicitCompanyId;
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem("ym_active_company_id"); } catch { return null; }
}

function mapRouteResultToRouted(result: ReturnType<typeof routeQuery>): RoutedQuery {
  return {
    intent: result.intent,
    entityHints: result.entity?.partyName ? [result.entity.partyName] : [],
    asOn: result.entity?.dateRange?.to,
    from: result.entity?.dateRange?.from,
    to: result.entity?.dateRange?.to,
  };
}

/** Merge previously-resolved context into the routed query so follow-up
 *  questions ("and as on 31/12/2025?", "what about last FY?") re-use the
 *  last party / date without the user having to repeat them. */
function enrichWithPrior(routed: RoutedQuery, prior?: ConversationMemory): RoutedQuery {
  if (!prior) return routed;
  const out: RoutedQuery = { ...routed, entityHints: [...routed.entityHints] };
  if (out.entityHints.length === 0 && prior.partyName) {
    out.entityHints.push(prior.partyName);
    // If the follow-up has no strong intent signal, inherit the last one so
    // "and as on 31/12/2025?" stays a party_balance lookup instead of falling
    // back to `unknown`.
    if (out.intent === "unknown" && prior.intent === "party_balance") {
      out.intent = prior.intent as IntentType;
    }
  }
  if (!out.asOn && !out.to && prior.asOnDate) {
    out.asOn = prior.asOnDate;
    out.to = prior.asOnDate;
    if (!out.from) out.from = prior.from;
  }
  return out;
}

function buildStructuredCard(routed: RoutedQuery, slice: RetrievedSlice): StructuredCard | undefined {
  if (routed.intent !== "party_balance") return undefined;
  const facts = slice.facts as Record<string, unknown> | undefined;
  if (!facts || facts.resolved_party_id == null) return undefined;
  const opening = Number(facts.opening_balance_paise ?? 0);
  const debit = Number(facts.total_debit_paise ?? 0);
  const credit = Number(facts.total_credit_paise ?? 0);
  const closing = Number(facts.closing_balance_paise ?? opening + debit - credit);
  const ms = facts.mode_split as { cash_paise?: number; bank_paise?: number; other_paise?: number } | undefined;
  return {
    kind: "party_balance",
    companyName: (facts.company_name as string | null | undefined) ?? null,
    partyName: String(facts.resolved_party_name ?? ""),
    partyGroup: (facts.resolved_party_group as string | null | undefined) ?? null,
    openingPaise: opening,
    debitPaise: debit,
    creditPaise: credit,
    closingPaise: closing,
    isDebit: closing >= 0,
    asOnDate: (facts.as_on_date as string | null | undefined) ?? null,
    voucherCount: Number(facts.voucher_count ?? 0),
    recentVouchers: Array.isArray(facts.recent_vouchers)
      ? (facts.recent_vouchers as any[]).map((v) => ({
          id: String(v.id ?? ""),
          number: String(v.number ?? ""),
          date: String(v.date ?? ""),
          kind: String(v.kind ?? ""),
          totalPaise: Number(v.total_paise ?? 0),
        }))
      : undefined,
    modeSplit: ms
      ? {
          cashPaise: Number(ms.cash_paise ?? 0),
          bankPaise: Number(ms.bank_paise ?? 0),
          otherPaise: Number(ms.other_paise ?? 0),
        }
      : undefined,
  };
}

/**
 * Build a compressed, PII-scrubbed context bundle for a user question.
 *
 * Pipeline: enrich-with-prior → routeQuery → retrieveForQuery → redactDeep →
 * cacheRowsForCcr → Headroom compression. Only the minimum slice needed to
 * answer the question leaves the device, and PII (GSTIN/PAN/phone/email/bank
 * a/c) is tokenised.
 */
export async function buildCompressedContext(
  userQuestion: string,
  companyId?: string | null,
  prior?: ConversationMemory,
): Promise<CompressedContext> {
  const routeResult = routeQuery(userQuestion);
  const routedRaw = mapRouteResultToRouted(routeResult);
  const routed = enrichWithPrior(routedRaw, prior);

  // Phase I — reuse the slice speculatively retrieved while the user typed,
  // but only when the final routing is byte-identical to what we guessed.
  let rawSlice: RetrievedSlice | null = null;
  try {
    const spec = await takeSpeculation(companyId, userQuestion);
    if (spec && spec.slice && JSON.stringify(mapRouteResultToRouted(spec.routed)) === JSON.stringify(routedRaw)) {
      rawSlice = spec.slice;
    }
  } catch {
    rawSlice = null;
  }
  if (!rawSlice) rawSlice = await retrieveForQuery(routed, resolveContextCompanyId(companyId));
  const slice: RetrievedSlice = optimiseSlice(rawSlice);

  const card = buildStructuredCard(routed, slice);

  const redaction = createRedactionMap();
  const safeData = redactDeep(slice.data, redaction);
  const safeFacts = slice.facts ? redactDeep(slice.facts, redaction) : undefined;

  const ccrHashes: Record<string, string> = {};
  for (const [key, rows] of Object.entries(safeData)) {
    if (Array.isArray(rows) && rows.length > 0) {
      ccrHashes[key] = cacheRowsForCcr(key, rows);
    }
  }

  const memorySnapshot = await buildMemorySnapshot(
    (slice.facts as any)?.company_id ?? resolveContextCompanyId(companyId),
  );

  const systemMessage = {
    role: "system" as const,
    content: [
      "You are an accounting assistant for an Indian accounting app. Accuracy is non-negotiable.",
      `The user's question was classified as intent="${routed.intent}" and only the`,
      "relevant slice of their books is attached in the JSON payload.",
      "",
      "STRICT RULES — violating any of these is a hard failure:",
      "1. NEVER invent, estimate, round, or guess a number, name, date, voucher number,",
      "   GSTIN, HSN, quantity, or rate. Every value in your answer MUST appear verbatim",
      "   in the attached `data` or `facts` object.",
      "2. If the required value is NOT in the payload, reply exactly:",
      '   "I could not find that in the attached slice of the books. Please rephrase or',
      '   open the relevant report." Do NOT fabricate steps, menus, or shortcuts you are',
      "   not certain exist. Do NOT guess the answer.",
      "3. If `data` contains a `candidates` array (fuzzy match failed), list the top 5",
      "   candidate names verbatim and ask the user which one they meant. Do NOT pick one.",
      "4. If the payload's `facts.company_id` differs from the entity the user named,",
      "   say so plainly — do NOT answer from the wrong company.",
      "5. Amounts in the payload are in INR rupees (2 dp) as `*_rs` fields. Show them",
      "   with the ₹ symbol and Indian digit grouping (e.g. ₹2,92,433.28). Never convert",
      "   units, never add taxes the payload did not compute.",
      "6. PII (GSTIN, PAN, phone, email, bank a/c) has been replaced with opaque tokens",
      '   like "<GSTIN_a1b2>" — reference those tokens as-is; the client substitutes real',
      "   values before the user sees your answer.",
      '7. Arrays may end with a `{"_more": N}` sentinel meaning N further rows were',
      "   trimmed. If the answer depends on those trimmed rows, say the slice is",
      "   incomplete and ask the user to narrow the question (date range, party, etc.)",
      "   rather than guessing.",
      "8. The client will render a verified balance card ABOVE your reply using values",
      "   from `facts`. Keep your prose short — explain, don't repeat the numbers.",
      "",
      "DOMAIN STYLE GUIDE — write like an Indian CA, not like ChatGPT:",
      "  • Indian numbering only: lakh / crore (never million / billion).",
      "  • Suffix balances with 'Dr' or 'Cr' — e.g. '₹ 5,42,300.00 Dr'.",
      "  • Use 'as on <date>' (never 'as of'). Use DD/MM/YYYY.",
      "  • Cite tax provisions as §-form: '§44AD', '§16(1) MSMED', 'AS-2', 'Ind AS 115' —",
      "    never 'Section 44AD of the Income-tax Act, 1961'.",
      "  • Preserve regional-script party names verbatim (Gujarati/Hindi/Marathi); do NOT",
      "    transliterate or translate them.",
      "  • Bilingual OK: financial vocabulary in English, party names in their native script.",
      "  • Prefer 'RCM', 'ITC', 'B2B/B2C', 'HSN/SAC', 'UQC' over spelling them out.",
      "  • Do NOT read out the ₹ symbol as a word when answering aloud; write it visually only.",
      "",
      "CITATIONS — every numeric or factual claim MUST be followed by a citation in one",
      "of these exact forms, drawn only from the attached payload:",
      "  [V:<voucher_number> <YYYY-MM-DD>]   — for a voucher shown in `data`",
      "  [L:<ledger name>]                    — for a ledger shown in `data`",
      "  [F:<fact key>]                       — for a value in the `facts` object",
      "Do not cite anything not present in the payload. Uncited numeric claims are",
      "treated as hallucination and are forbidden.",
      memorySnapshot ? "\n" + memorySnapshot : "",
      "",
      toolCatalogPrompt(),
    ].join("\n"),
  };

  const userMessage = {
    role: "user" as const,
    content: JSON.stringify(
      {
        question: redactDeep(userQuestion, redaction),
        intent: routed.intent,
        scope: redactString(slice.scope, redaction),
        entityHints: redactDeep(routed.entityHints, redaction),
        dateRange: routed.from || routed.to ? { from: routed.from, to: routed.to } : undefined,
        priorContext: prior && (prior.partyName || prior.asOnDate)
          ? { partyName: prior.partyName, asOnDate: prior.asOnDate }
          : undefined,
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

  const memory: ConversationMemory = {
    companyId: (slice.facts as any)?.company_id ?? companyId ?? prior?.companyId ?? null,
    partyName: card?.partyName ?? prior?.partyName,
    partyLedgerId: (slice.facts as any)?.resolved_party_id ?? prior?.partyLedgerId,
    asOnDate: routed.asOn ?? routed.to ?? prior?.asOnDate,
    from: routed.from ?? prior?.from,
    to: routed.to ?? prior?.to,
    intent: routed.intent,
  };

  return {
    systemMessage: messages[0] as { role: "system"; content: string },
    userMessage: messages[1] as { role: "user"; content: string },
    ccrHashes,
    compressed,
    intent: routed.intent,
    scope: slice.scope,
    redaction,
    card,
    memory,
  };
}

/** Convenience: un-tokenise the model's reply before rendering to the user. */
export function unredactAnswer(text: string, ctx: Pick<CompressedContext, "redaction">): string {
  return unredact(text, ctx.redaction);
}
