// Client-side assistant runtime.
//
// Pipeline:
//   1. Pull raw accounting rows from local SQLite.
//   2. Pass them through Headroom `compress()` (with CCR fallback) so the
//      payload sent to the model is small.
//   3. Run the prompt against the local LLM (WebLLM / WebGPU). If WebGPU is
//      unavailable we degrade to the offline KB result handled by the
//      caller.
//   4. If the model asks for a specific raw row by CCR hash, fetch it
//      transparently and re-run.
//
// All of this is invisible to the user: they ask a question, they get an
// answer.

import { buildCompressedContext } from "./ai/sqliteContext";
import { retrieveOriginal } from "./ai/headroom";
import { isWebGpuAvailable, webLlmChat } from "./ai/webllm";

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

export async function assistantChat(args?: AssistantArgs): Promise<AssistantChatResult> {
  const history = args?.data?.messages ?? [];
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() ?? "";
  if (!question) {
    return { ok: false, text: "", error: "Empty question." };
  }

  if (!isWebGpuAvailable()) {
    return {
      ok: false,
      text: "",
      error:
        "Local AI engine needs WebGPU, which isn't available in this environment. The offline knowledge base will be used instead.",
    };
  }

  try {
    const ctx = await buildCompressedContext(question);

    const baseMessages = [
      ctx.systemMessage,
      ...history
        .slice(-6)
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ctx.userMessage,
    ];

    let answer = await webLlmChat(baseMessages as any);

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
        const followUp = [
          ctx.systemMessage,
          ctx.userMessage,
          {
            role: "assistant" as const,
            content: answer,
          },
          {
            role: "user" as const,
            content:
              "Here are the original rows you requested via retrieveOriginal. " +
              "Use them to give the final answer:\n" +
              JSON.stringify(retrieved),
          },
        ];
        answer = await webLlmChat(followUp as any);
      }
    }

    return { ok: true, text: answer };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", error: msg };
  }
}

// --- Voucher drafting -----------------------------------------------------
// The previous server stub returned a deterministic null. The voucher form
// pipeline only needs a structured draft, which we can produce locally by
// asking the model for JSON. Falls back to a heuristic if WebGPU is absent.

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
  // even when the local LLM can't run.
  const amtMatch = text.replace(/[,]/g, "").match(/(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const amount = amtMatch ? Number(amtMatch[1]) : 0;

  if (!isWebGpuAvailable()) {
    return {
      ok: true,
      draft: { date: today, amount, narration: text },
    };
  }

  try {
    const sys = {
      role: "system" as const,
      content:
        "Return ONLY a JSON object with keys: date (YYYY-MM-DD), amount (number), " +
        "narration (string), refNo (string|null), partyLedgerId (string|null), " +
        "cashBankLedgerId (string|null), counterLedgerId (string|null). " +
        "Pick ledger ids from the provided list when the user names them.",
    };
    const user = {
      role: "user" as const,
      content: JSON.stringify({ text, today, ledgers }),
    };
    const raw = await webLlmChat([sys, user] as any, { temperature: 0.1 });
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
