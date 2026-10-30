// Client-side assistant runtime.
//
// Pipeline:
//   1. Intent routing & tool execution.
//   2. Pull raw accounting rows from local SQLite.
//   3. Pass them through Headroom `compress()` (with CCR fallback).
//   4. Try Local WebLLM -> Cloud Gateway.
//   5. Verifier check.

import { supabase } from "@/integrations/supabase/client";
import { buildCompressedContext, unredactAnswer, type StructuredCard } from "./ai/sqliteContext";
import { retrieveOriginal } from "./ai/headroom";
import { isWebGpuAvailable, webLlmChat } from "./ai/webllm";
import { getModelPreference } from "./ai/model-preference";
import { recentErrors, questionMentionsError } from "./ai/error-ring";
import { lookupAnswer, storeAnswer } from "./ai/answer-cache";
import type { ConversationMemory } from "./ai/conversation-memory";
import { executeTool, parseToolCall, stripToolCall } from "./ai/tools";
import { localFirstAnswer } from "./ai/local-first";
import { routeQuery } from "./ai/query-router";
import { searchKb } from "./assistant-engine";
import { detectVoucherIntent, fetchContextLedgers, isReadOnlyQuery, type VoucherIntentType, intentToRoute } from "./voucher-intent";
import { detectVoucherAction, parseAmount, type VoucherAction, type VoucherExecutionResult } from "./ai/voucher-actions";
import { INDIAN_STATES } from "./constants";
import type { KbEntry } from "./assistant-knowledge";
import { writeAssistantPrefill } from "./voucher-intent";

export interface AssistantChatResult {
  ok: boolean;
  text: string;
  error?: string;
  toolCalls?: { name: string; input: string }[];
  card?: StructuredCard;
  memory?: ConversationMemory;
  latencyMs?: number;
  
  // UI triggers
  matches?: KbEntry[];
  pendingCompany?: ParsedCompany;
  pendingVoucher?: ParsedVoucher;
  voucherAction?: VoucherAction;
  voucherResult?: VoucherExecutionResult;
}

export type ParsedCompany = {
  name?: string;
  gstin?: string;
  pan?: string;
  state?: string;
  state_code?: string;
  phone?: string;
  email?: string;
  address?: string;
  financial_year_start?: string;
  inventory_enabled?: boolean;
};

export type ParsedVoucher = {
  intent: VoucherIntentType;
  date: string;
  amount: number;
  amountPaise: number;
  narration?: string;
  refNo?: string;
  partyLedgerId?: string;
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  displayDetails: {
    partyName?: string;
    accountName?: string;
  };
};

interface AssistantArgs {
  data?: {
    companyId?: string | null;
    messages?: { role: string; content: string }[];
    prior?: ConversationMemory;
    userId?: string;
  };
}

const RETRIEVAL_RE = /retrieveOriginal\(["']([a-zA-Z0-9_:.-]+)["']\)/g;

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

async function cloudChat(
  messages: ChatMsg[],
  temperature = 0.3,
  extra?: { route?: string; recentErrors?: unknown[] },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: { messages, temperature, ...extra },
  });
  if (error) throw new Error(error.message || "Cloud AI request failed");
  const payload = data as { ok?: boolean; text?: string; error?: string } | null;
  if (!payload || payload.ok === false) {
    throw new Error(payload?.error || "Cloud AI returned no answer");
  }
  return payload.text ?? "";
}

function looksOfflineOrBlocked(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /failed to fetch/i.test(msg) ||
    /failed to send a request/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /offline/i.test(msg) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );
}

function offlineAssistantAnswer(question: string, cause?: unknown): string {
  const causeText = cause instanceof Error ? cause.message : String(cause ?? "offline/network unavailable");
  return [
    "**Offline diagnostic mode is active.**",
    "",
    "The cloud AI Edge Function is not reachable from this Windows/Tauri session.",
    `Reason detected: ${causeText}`,
    "",
    "This app never syncs business data to the cloud, so you can still diagnose voucher balance and orphans from the cached company data on this device.",
    "",
    question ? `Your question: ${question}` : "",
  ].filter(Boolean).join("\n");
}

async function smartChat(
  messages: ChatMsg[],
  temperature = 0.3,
  extra?: { route?: string; recentErrors?: unknown[] },
): Promise<string> {
  const pref = getModelPreference();

  if (pref !== "cloud" && isWebGpuAvailable()) {
    try {
      return await webLlmChat(messages as never, { temperature });
    } catch (err) {
      console.warn("[assistant] WebGPU local LLM failed:", err);
      if (pref === "local") {
        throw new Error("On-device AI could not start and you have chosen device-only mode.");
      }
    }
  } else if (pref === "local") {
    throw new Error("Device-only AI mode is on, but this machine has no WebGPU support.");
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Offline: cloud AI is not reachable and WebGPU local AI is unavailable.");
  }
  return cloudChat(messages, temperature, extra);
}

function formatInr(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);
}

function extractRupeeFigures(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:[,\s][0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi;
  for (const m of text.matchAll(re)) {
    const num = Number(m[1].replace(/[,\s]/g, ""));
    if (!Number.isNaN(num)) out.push(Math.round(num * 100));
  }
  return out;
}

function verifyAnswer(text: string, card: StructuredCard | undefined): string {
  if (!card) return text;
  const truthPaise = Math.abs(card.closingPaise ?? 0);
  const figures = extractRupeeFigures(text);
  if (figures.length === 0) return text;
  const off = figures.some((f) => Math.abs(f - truthPaise) > 100);
  if (!off) return text;
  const drCr = card.isDebit ? "Dr" : "Cr";
  const asOn = card.asOnDate ? ` as on ${card.asOnDate}` : "";
  const banner =
    `> ⚠️ **Verified from your books:** ${card.partyName} — ` +
    `${formatInr(truthPaise)} ${drCr}${asOn}. ` +
    `The narrative below may reference a different figure — trust the verified number.\n\n`;
  return banner + text;
}

// Intent Parsing Helpers
function parseCompanyDetails(text: string): ParsedCompany | null {
  const out: Record<string, unknown> = {};
  const kvRe = /\b(name|company|firm|gstin|gst|pan|state code|state_code|state|phone|mobile|email|mail|address|addr|fy|financial year|inventory|stock)\s*[:=\-]\s*([^,\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(text)) !== null) {
    const k = m[1].toLowerCase().trim();
    const v = m[2].trim();
    if (!v) continue;
    if (k === "name" || k === "company" || k === "firm") out.name = v;
    else if (k === "gstin" || k === "gst") out.gstin = v.toUpperCase().replace(/\s+/g, "");
    else if (k === "pan") out.pan = v.toUpperCase().replace(/\s+/g, "");
    else if (k === "state code" || k === "state_code") out.state_code = v.replace(/[^0-9]/g, "");
    else if (k === "state") out.state = v;
    else if (k === "phone" || k === "mobile") out.phone = v;
    else if (k === "email" || k === "mail") out.email = v;
    else if (k === "address" || k === "addr") out.address = v;
    else if (k === "fy" || k === "financial year") out.financial_year_start = v;
    else if (k === "inventory" || k === "stock")
      out.inventory_enabled = /^(y|yes|true|on|1|enable)/i.test(v);
  }
  const gstMatch = text.toUpperCase().match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/i);
  if (!out.gstin && gstMatch) out.gstin = gstMatch[1];
  const panMatch = text.toUpperCase().match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
  if (!out.pan && panMatch) out.pan = panMatch[1];
  if (!out.state_code && typeof out.gstin === "string" && out.gstin.length >= 2) out.state_code = out.gstin.slice(0, 2);
  if (out.state_code && !out.state) {
    const found = INDIAN_STATES.find((s) => s.code === out.state_code);
    if (found) out.state = found.name;
  }
  return Object.keys(out).length === 0 ? null : (out as ParsedCompany);
}

function detectCreateCompanyIntent(t: string): boolean {
  const s = t.toLowerCase();
  return /\b(create|add|new|make|setup|set up|register)\b/.test(s) && /\b(company|firm|business|organi[sz]ation)\b/.test(s);
}

/** Intents whose answer can be produced entirely from local books — no LLM, no
 *  compressed-context build. Phase 1 local-first gate. */
const DETERMINISTIC_INTENTS = new Set([
  "party_balance",
  "party_ledger",
  "cash_balance",
  "bank_balance",
  "trial_balance",
  "voucher_lookup",
]);

/** Cheap cache scope derived from the route alone (no retrieval needed). */
function routeScope(route: any): string {
  const bits: string[] = [];
  if (route?.entity?.partyName) bits.push(`party:${String(route.entity.partyName).toLowerCase()}`);
  if (route?.entity?.accountName) bits.push(`account:${String(route.entity.accountName).toLowerCase()}`);
  if (route?.from) bits.push(`from:${route.from}`);
  if (route?.to) bits.push(`to:${route.to}`);
  return bits.join(",") || "all";
}

async function tryDirectToolAnswer(route: any, text: string, companyId: string): Promise<AssistantChatResult | null> {
  if (!companyId || route.requiresLLM) return null;
  if (!DETERMINISTIC_INTENTS.has(route.intent) || route.confidence < 0.6) return null;
  let toolName: string | null = null;
  let toolArgs: Record<string, unknown> = {};
  switch (route.intent) {
    case "party_balance":
      if (route.entity?.partyName) {
        toolName = "get_party_balance";
        toolArgs = { name: route.entity.partyName, asOn: route.entity.dateRange?.to };
      }
      break;
    case "party_ledger":
      if (route.entity?.partyName) {
        toolName = "get_party_ledger";
        toolArgs = { name: route.entity.partyName, from: route.entity.dateRange?.from, to: route.entity.dateRange?.to };
      }
      break;
    case "cash_balance":
      toolName = "get_cash_balance";
      toolArgs = { account: "cash", asOn: route.entity?.dateRange?.to };
      break;
    case "bank_balance":
      toolName = "get_cash_balance";
      toolArgs = { account: route.entity?.accountName || "bank", asOn: route.entity?.dateRange?.to };
      break;
    case "trial_balance":
      toolName = "get_trial_balance";
      toolArgs = { asOn: route.entity?.dateRange?.to };
      break;
    case "voucher_lookup":
      toolName = "list_vouchers";
      toolArgs = { from: route.entity?.dateRange?.from, to: route.entity?.dateRange?.to, kind: route.entity?.voucherType };
      break;
  }
  if (!toolName) return null;
  try {
    const result = await executeTool(toolName, toolArgs);
    if (!result.success || !result.data) return null;
    // The accounting engine refused to guess a ledger — surface its
    // clarification instead of any balance figure.
    const clarification = (result.data as any)?.clarification;
    if (typeof clarification === "string" && clarification) {
      return { ok: true, text: clarification };
    }
    const card = buildCardFromResult(route.intent, result.data, route.entity);
    if (!card) return null;
    const prose = localFirstAnswer(card);
    if (!prose) return null;
    return { ok: true, text: prose, card };
  } catch (e) {
    console.error(`[assistant] tryDirectToolAnswer failed for ${toolName}:`, e);
    return null;
  }
}

function buildCardFromResult(intent: string, data: any, entity: any): StructuredCard | undefined {
  const facts = data?.facts || {};
  if (intent === "party_balance" || intent === "party_ledger") {
    if (intent === "party_balance" && facts.closing_balance_paise === undefined) return undefined;
    const closing = Number(facts.closing_balance_paise ?? 0);
    return {
      kind: intent === "party_ledger" ? "voucher_list" : "party_balance",
      // The engine's resolved ledger name is authoritative over the raw phrase.
      partyName: String(facts.resolved_party_name || entity?.partyName || ""),
      closingPaise: closing,
      isDebit: closing >= 0,
      asOnDate: entity?.dateRange?.to || facts.as_on_date || null,
      openingPaise: Number(facts.opening_balance_paise ?? 0),
      debitPaise: Number(facts.total_debit_paise ?? 0),
      creditPaise: Number(facts.total_credit_paise ?? 0),
      voucherCount: Number(facts.voucher_count ?? facts.entry_count ?? 0),
      vouchers: Array.isArray(data.entries) ? data.entries : (Array.isArray(facts.recent_vouchers) ? facts.recent_vouchers : undefined),
    };
  }
  if (intent === "cash_balance" || intent === "bank_balance") {
    if (facts.closing_balance_paise === undefined) return undefined;
    const closing = Number(facts.closing_balance_paise ?? 0);
    return {
      kind: intent as any,
      accountName: String(facts.account_name || entity?.accountName || (intent === "cash_balance" ? "Cash" : "Bank")),
      closingPaise: closing,
      isDebit: closing >= 0,
    };
  }
  if (intent === "trial_balance") {
    const raw = Array.isArray(data?.data?.trial_balance) ? data.data.trial_balance : [];
    if (!raw.length) return undefined;
    return {
      kind: "trial_balance",
      asOnDate: facts.as_on_date ?? entity?.dateRange?.to ?? null,
      // Figures are the engine's; nothing here recalculates them.
      rows: raw.map((r: any) => ({
        name: String(r.name ?? ""),
        debitPaise: Number(r.debit_paise ?? (Number(r.closing_paise ?? 0) > 0 ? r.closing_paise : 0)),
        creditPaise: Number(r.credit_paise ?? (Number(r.closing_paise ?? 0) < 0 ? -Number(r.closing_paise) : 0)),
        closingPaise: Number(r.closing_paise ?? 0),
      })),
      totalDebitPaise:
        facts.total_debit_paise === undefined ? undefined : Number(facts.total_debit_paise),
      totalCreditPaise:
        facts.total_credit_paise === undefined ? undefined : Number(facts.total_credit_paise),
      balanced: typeof facts.balanced === "boolean" ? facts.balanced : undefined,
    };
  }
  if (intent === "voucher_lookup") {
    const list = Array.isArray(data?.vouchers) ? data.vouchers : (Array.isArray(data?.data?.vouchers) ? data.data.vouchers : []);
    if (!list.length) return undefined;
    return { kind: "voucher_list", vouchers: list };
  }
  return undefined;
}

const QUESTION_START = /^(how|what|where|why|when|who|which|can|could|is|are|do|does|tell|show|help|explain|list|open)\b/i;

const ENTRY_HELP =
  "I record entries for this company. Tell me what to record, for example:\n" +
  "• receipt 5000 from Ram in HDFC today\n" +
  "• payment 1200 to landlord cash\n" +
  "• sales 25000 to Ram Traders on 15/03\n" +
  "I show a preview first and save only when you confirm. Include the type, the amount and the party name.";

const NO_COMPANY_HELP = "Open a company first. Then I can record entries for it.";

const CLARIFY_DIRECTION =
  "Nothing is saved yet. Did this money come in or go out? Reply with \"received\" for money in, or \"paid\" for money out, and I will prepare the entry. " +
  "For example: \"received 5000 from Ram in HDFC\" or \"paid 1200 to landlord cash\".";

// Words that make a sentence a question or a report, never an entry.
const CLARIFY_BLOCKERS =
  /\b(balance|bal|kitna|kitne|kitni|how much|how many|due|dues|outstanding|overdue|total|report|register|day ?book|ledger|statement|summary|list|show|tell|kab|kaun|kahan)\b/i;

/** True for "1200 to landlord cash" style text: an amount plus a party, bank or cash phrase. */
function looksLikeBareEntry(text: string): boolean {
  if (CLARIFY_BLOCKERS.test(text)) return false;
  if (parseAmount(text) === null) return false;
  return /\b(from|to|in|by|cash|bank|on|via)\b/i.test(text);
}

export async function assistantChat(args?: AssistantArgs): Promise<AssistantChatResult> {
  const start = performance.now();
  const history = args?.data?.messages ?? [];
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() ?? "";
  const companyId = args?.data?.companyId ?? null;
  
  if (!question) return { ok: false, text: "", error: "Empty question." };

  try {
    const entryCompanyId = companyId || (typeof window !== "undefined" ? window.localStorage?.getItem("ym_active_company_id") ?? "" : "");
    const looksLikeQuestion = /\?\s*$/.test(question) || QUESTION_START.test(question);
    if (entryCompanyId && !looksLikeQuestion && !isReadOnlyQuery(question)) {
      const action = await detectVoucherAction(question, entryCompanyId);
      if (action) {
        // Never save straight from chat: every entry is shown as a preview and
        // saved only when the user confirms it.
        // Never draft an entry whose ledgers are unknown: posting would fall back
        // to placeholder ids. Ask for the missing ledger instead.
        const needsBank = action.draft.intent === "receipt" || action.draft.intent === "payment";
        const missing = !action.draft.partyLedgerId
          ? "other ledger (the party, or the income or expense head)"
          : needsBank && !action.draft.cashBankLedgerId
            ? "bank or cash ledger"
            : null;
        if (missing) {
          return {
            ok: true,
            text: `Nothing is saved yet. Which ${missing} should this entry use? Please repeat the entry with the exact ledger name, for example "rent received in bank of baroda 9500 from Rent Income on 15/05/2026".`,
            latencyMs: Math.round(performance.now() - start),
          };
        }
        const draft: ParsedVoucher = {
          intent: action.draft.intent,
          date: action.draft.date,
          amount: action.draft.amount,
          amountPaise: action.draft.amountPaise,
          narration: action.draft.narration,
          refNo: action.draft.refNo,
          partyLedgerId: action.draft.partyLedgerId,
          cashBankLedgerId: action.draft.cashBankLedgerId,
          counterLedgerId: action.draft.counterLedgerId,
          displayDetails: action.draft.displayDetails,
        };
        return { ok: true, text: "Drafted voucher. Confirm to save.", pendingVoucher: draft, voucherAction: action, latencyMs: Math.round(performance.now() - start) };
      }
      // An amount with a party or bank phrase, but no word saying the money came
      // in or went out. Ask, rather than answering it as a balance question.
      if (!detectVoucherIntent(question) && looksLikeBareEntry(question)) {
        return { ok: true, text: CLARIFY_DIRECTION, latencyMs: Math.round(performance.now() - start) };
      }
    }

    const route = routeQuery(question);

    // 1. Instant greeting / deterministic
    if (!route.requiresLLM && !route.requiresTools && route.deterministicAnswer) {
      return { ok: true, text: route.deterministicAnswer, latencyMs: Math.round(performance.now() - start) };
    }

    const isDeterministic = DETERMINISTIC_INTENTS.has(route.intent);
    const earlyCompanyId =
      companyId ?? (typeof window !== "undefined" ? window.localStorage?.getItem("ym_active_company_id") ?? "" : "");

    // Live financial balances must always be recalculated from the current
    // books. Never return an answer-cache entry for a balance question:
    // an older answer can refer to the wrong ledger or an older book state.
    const isLiveBalanceIntent =
      route.intent === "party_balance" ||
      route.intent === "cash_balance" ||
      route.intent === "bank_balance" ||
      route.intent === "trial_balance";

    // 2a. Cached deterministic answer — before any retrieval or context build.
    if (isDeterministic && earlyCompanyId && !isLiveBalanceIntent) {
      const cachedFast = lookupAnswer(earlyCompanyId, route.intent, routeScope(route), question);
      if (cachedFast) return { ok: true, text: cachedFast, latencyMs: Math.round(performance.now() - start) };
    }

    // 2b. Speed path / Direct Tool — targeted local calculation, no LLM context.
    if (companyId || earlyCompanyId) {
      const fastResult = await tryDirectToolAnswer(route, question, companyId || earlyCompanyId);
      if (fastResult) {
        if (earlyCompanyId && !isLiveBalanceIntent) {
          storeAnswer(earlyCompanyId, route.intent, routeScope(route), question, fastResult.text);
        }
        return { ...fastResult, latencyMs: Math.round(performance.now() - start) };
      }
    }

    // 3. Offline KB search (skipped for book-data questions)
    if (!isDeterministic) {
      const matches = searchKb(question);
      if (matches.length > 0 && matches[0].score > 0.85) {
        return { ok: true, text: matches[0].entry.answer, matches: matches.map((m: { entry: KbEntry }) => m.entry), latencyMs: Math.round(performance.now() - start) };
      }
    }

    // 4. Company creation intent
    const parsed = parseCompanyDetails(question);
    if (parsed && parsed.name) {
      return { ok: true, text: "Review the details to create the company.", pendingCompany: parsed, latencyMs: Math.round(performance.now() - start) };
    }
    if (detectCreateCompanyIntent(question)) {
      return { ok: true, text: "I can help you create a company. Tell me the name, GSTIN, and state.", latencyMs: Math.round(performance.now() - start) };
    }

    // 6. Data-entry assistant: no free-form LLM answers. Say plainly what
    // can be entered instead of guessing.
    return {
      ok: true,
      text: companyId || earlyCompanyId ? ENTRY_HELP : NO_COMPANY_HELP,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    if (looksOfflineOrBlocked(err)) return { ok: true, text: offlineAssistantAnswer(question, err) };
    return { ok: false, text: "", error: String(err) };
  }
}

// Keep assistantDraftVoucher for backward compatibility if needed, 
// but it is now integrated into assistantChat logic flow.
export async function assistantDraftVoucher(args?: any): Promise<any> {
  const today = args?.data?.today ?? new Date().toISOString().slice(0, 10);
  const text = args?.data?.text ?? "";
  const ledgers = args?.data?.ledgers ?? [];
  const amtMatch = text.replace(/[,]/g, "").match(/(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const amount = amtMatch ? Number(amtMatch[1]) : 0;
  try {
    const sys = { role: "system", content: "Return ONLY JSON with keys: date, amount, narration, refNo, partyLedgerId, cashBankLedgerId, counterLedgerId." };
    const user = { role: "user", content: JSON.stringify({ text, today, ledgers }) };
    const raw = await smartChat([sys as any, user as any], 0.1);
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("no JSON");
    const draft = JSON.parse(json);
    if (!draft.date) draft.date = today;
    if (!draft.amount) draft.amount = amount;
    return { ok: true, draft };
  } catch (err) {
    return { ok: true, draft: { date: today, amount, narration: text }, error: String(err) };
  }
}

