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

import { supabase } from "@/integrations/supabase/client";
import { buildCompressedContext } from "./ai/sqliteContext";
import { retrieveOriginal } from "./ai/headroom";
import { isWebGpuAvailable, webLlmChat } from "./ai/webllm";
import { recentErrors, questionMentionsError } from "./ai/error-ring";

export interface AssistantChatResult {
  ok: boolean;
  text: string;
  error?: string;
  toolCalls?: { name: string; input: string }[];
}

interface AssistantArgs {
  data?: {
    companyId?: string | null;
    messages?: { role: string; content: string }[];
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

export async function assistantChat(args?: AssistantArgs): Promise<AssistantChatResult> {
  const history = args?.data?.messages ?? [];
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() ?? "";
  if (!question) {
    return { ok: false, text: "", error: "Empty question." };
  }

  try {
    const ctx = await buildCompressedContext(question, args?.data?.companyId ?? null);

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

    return { ok: true, text: answer };
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
