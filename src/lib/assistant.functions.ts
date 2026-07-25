// Client-side assistant runtime.
//
// Pipeline:
//   1. Pull raw accounting rows from local SQLite.
//   2. Pass them through Headroom `compress()` (with CCR fallback) so the
//      payload sent to the model is small.
//   3. Try the local WebLLM (WebGPU). If WebGPU isn't available or the
//      engine fails to initialise, transparently fall back to the
//      Lovable AI Gateway via the `ai-assistant` edge function so the
//      assistant still answers.
//   4. If the model asks for a specific raw row by CCR hash, fetch it
//      transparently and re-run.
//   5. Verifier — before returning, cross-check any ₹ figures in the reply
//      against the deterministic aggregator (`ctx.card`). If they disagree,
//      prepend a "Verified figure from your books" banner so the ground
//      truth is what the user sees first.

import { supabase } from "@/integrations/supabase/client";
import { buildCompressedContext, unredactAnswer, type StructuredCard } from "./ai/sqliteContext";
import { retrieveOriginal } from "./ai/headroom";
import { isWebGpuAvailable, webLlmChat } from "./ai/webllm";
import { recentErrors, questionMentionsError } from "./ai/error-ring";
import { lookupAnswer, storeAnswer } from "./ai/answer-cache";
import type { ConversationMemory } from "./ai/conversation-memory";
import { executeTool, parseToolCall, stripToolCall } from "./ai/tools";
import { localFirstAnswer } from "./ai/local-first";

export interface AssistantChatResult {
  ok: boolean;
  text: string;
  error?: string;
  toolCalls?: { name: string; input: string }[];
  /** Structured, deterministic answer card (rendered above the prose). */
  card?: StructuredCard;
  /** Updated conversation memory — the caller should persist for the next turn. */
  memory?: ConversationMemory;
}

interface AssistantArgs {
  data?: {
    companyId?: string | null;
    messages?: { role: string; content: string }[];
    /** Prior turn's resolved party / date / company — see conversation-memory.ts. */
    prior?: ConversationMemory;
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
    "The cloud AI Edge Function is not reachable from this Windows/Tauri session, so I did **not** keep retrying the network request.",
    `Reason detected: ${causeText}`,
    "",
    "For the Reindex & Re-post error you reported, the important fix is: everything must read and write the local IndexedDB. You can still diagnose voucher balance, orphan rows, and rebuild derived postings from the cached company data on this device.",
    "",
    "This app never syncs business data to the cloud, so there is nothing to defer or retry against a server — reindex and re-post are local-only operations.",
    "",
    question ? `Your question: ${question}` : "",
  ].filter(Boolean).join("\n");
}

async function smartChat(
  messages: ChatMsg[],
  temperature = 0.3,
  extra?: { route?: string; recentErrors?: unknown[] },
): Promise<string> {
  if (isWebGpuAvailable()) {
    try {
      return await webLlmChat(messages as never, { temperature });
    } catch (err) {
      // WebGPU adapter missing / engine init failed — fall through to cloud.
      console.warn("[assistant] WebGPU local LLM failed, falling back to cloud:", err);
    }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Offline: cloud AI is not reachable and WebGPU local AI is unavailable.");
  }
  return cloudChat(messages, temperature, extra);
}

/** Format paise → "₹2,92,433.28" (Indian grouping). */
function formatInr(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);
}

/** Extract ₹ amounts from a model reply, returning paise. */
function extractRupeeFigures(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:[,\s][0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi;
  for (const m of text.matchAll(re)) {
    const num = Number(m[1].replace(/[,\s]/g, ""));
    if (!Number.isNaN(num)) out.push(Math.round(num * 100));
  }
  return out;
}

/**
 * Verifier — compare every ₹ figure in the model reply against the
 * deterministic closing balance. If the model's headline number is off by
 * more than 1 rupee, prepend a corrective banner. This prevents hallucinated
 * balances from being the first thing the user reads.
 */
function verifyAnswer(text: string, card: StructuredCard | undefined): string {
  if (!card) return text;
  const truthPaise = Math.abs(card.closingPaise);
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

export async function assistantChat(args?: AssistantArgs): Promise<AssistantChatResult> {
  const history = args?.data?.messages ?? [];
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() ?? "";
  if (!question) {
    return { ok: false, text: "", error: "Empty question." };
  }

  try {
    const ctx = await buildCompressedContext(question, args?.data?.companyId ?? null, args?.data?.prior);
    const cacheCompanyId = args?.data?.companyId
      ?? (typeof window !== "undefined" ? window.localStorage?.getItem("ym_active_company_id") ?? "" : "");

    // Tier 3 #12 — Local-first: for deterministic intents the structured
    // card IS the answer. Skip the LLM entirely (no tokens, no credits, no
    // network) and return a formulaic blurb the UI renders beneath the card.
    const localAnswer = localFirstAnswer(ctx.card);
    if (localAnswer) {
      if (cacheCompanyId) storeAnswer(cacheCompanyId, ctx.intent, ctx.scope, question, localAnswer);
      return { ok: true, text: localAnswer, card: ctx.card, memory: ctx.memory };
    }

    // Answer cache — same intent+scope+question inside TTL returns instantly.
    if (cacheCompanyId) {
      const cached = lookupAnswer(cacheCompanyId, ctx.intent, ctx.scope, question);
      if (cached) return { ok: true, text: cached, card: ctx.card, memory: ctx.memory };
    }

    const baseMessages: ChatMsg[] = [
      ctx.systemMessage as ChatMsg,
      ...history
        .slice(-6)
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ctx.userMessage as ChatMsg,
    ];

    // If the user is asking about an error/bug, attach the recent runtime
    // error ring so the model can name the exact failure.
    const errs = questionMentionsError(question) ? recentErrors(15) : [];
    const route = typeof window !== "undefined" ? window.location?.pathname : undefined;
    const extra = { route, recentErrors: errs };

    let answer = await smartChat(baseMessages, 0.2, extra);

    // Tier 3 #9 — Tool-calling loop. The model may emit a
    // [[TOOL_CALL {...}]] block instead of a final answer; we execute the
    // tool locally against IndexedDB and feed the result back. Bounded to
    // 3 rounds so a stuck model never spins forever.
    const toolTrail: { name: string; input: string }[] = [];
    const toolConvo: ChatMsg[] = [...baseMessages];
    for (let round = 0; round < 3; round++) {
      const call = parseToolCall(answer);
      if (!call) break;
      let result: unknown;
      try { result = await executeTool(call.name, call.args); }
      catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
      toolTrail.push({ name: call.name, input: JSON.stringify(call.args) });
      toolConvo.push({ role: "assistant", content: answer });
      toolConvo.push({
        role: "user",
        content:
          `[[TOOL_RESULT name="${call.name}"]]\n` +
          JSON.stringify(result) +
          "\n\nUse this result to answer. Do not emit another tool call unless it is strictly required.",
      });
      answer = await smartChat(toolConvo, 0.2, extra);
    }

    // CCR fallback: if the model references a hash, fetch the raw rows
    // and let it answer again with the expanded context.
    const matches = [...answer.matchAll(RETRIEVAL_RE)].map((m) => m[1]);
    if (matches.length > 0) {
      const retrieved: Record<string, unknown> = {};
      for (const h of matches) {
        const r = await retrieveOriginal(h);
        if (r) retrieved[h] = r.rows;
      }
      if (Object.keys(retrieved).length > 0) {
        const followUp: ChatMsg[] = [
          ctx.systemMessage as ChatMsg,
          ctx.userMessage as ChatMsg,
          { role: "assistant", content: answer },
          {
            role: "user",
            content:
              "Here are the original rows you requested via retrieveOriginal. " +
              "Use them to give the final answer:\n" +
              JSON.stringify(retrieved),
          },
        ];
        answer = await smartChat(followUp);
      }
    }

    // Strip any residual tool-call block so it doesn't leak into the UI.
    const cleanAnswer = stripToolCall(answer);
    const finalText = verifyAnswer(unredactAnswer(cleanAnswer, ctx), ctx.card);
    if (cacheCompanyId) storeAnswer(cacheCompanyId, ctx.intent, ctx.scope, question, finalText);
    return {
      ok: true,
      text: finalText,
      card: ctx.card,
      memory: ctx.memory,
      toolCalls: toolTrail.length ? toolTrail : undefined,
    };
  } catch (err) {
    if (looksOfflineOrBlocked(err)) {
      return { ok: true, text: offlineAssistantAnswer(question, err) };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", error: msg };
  }
}

// --- Voucher drafting -----------------------------------------------------

export interface AssistantDraft {
  date: string;
  partyLedgerId?: string | null;
  cashBankLedgerId?: string | null;
  counterLedgerId?: string | null;
  amount: number;
  narration?: string;
  refNo?: string;
}

export interface AssistantDraftResult {
  ok: boolean;
  draft: AssistantDraft | null;
  error?: string;
}

interface DraftArgs {
  data?: {
    voucherType?: string;
    text?: string;
    today?: string;
    ledgers?: { id: string; name: string }[];
  };
}

export async function assistantDraftVoucher(args?: DraftArgs): Promise<AssistantDraftResult> {
  const today = args?.data?.today ?? new Date().toISOString().slice(0, 10);
  const text = args?.data?.text ?? "";
  const ledgers = args?.data?.ledgers ?? [];

  // Heuristic: pull an amount if present so the form is at least pre-filled
  // even when the model can't run.
  const amtMatch = text.replace(/[,]/g, "").match(/(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const amount = amtMatch ? Number(amtMatch[1]) : 0;

  try {
    const sys: ChatMsg = {
      role: "system",
      content:
        "Return ONLY a JSON object with keys: date (YYYY-MM-DD), amount (number), " +
        "narration (string), refNo (string|null), partyLedgerId (string|null), " +
        "cashBankLedgerId (string|null), counterLedgerId (string|null). " +
        "Pick ledger ids from the provided list when the user names them.",
    };
    const user: ChatMsg = {
      role: "user",
      content: JSON.stringify({ text, today, ledgers }),
    };
    const raw = await smartChat([sys, user], 0.1);
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("model did not return JSON");
    const draft = JSON.parse(json) as AssistantDraft;
    if (!draft.date) draft.date = today;
    if (!draft.amount) draft.amount = amount;
    return { ok: true, draft };
  } catch (err) {
    return {
      ok: true,
      draft: { date: today, amount, narration: text },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
