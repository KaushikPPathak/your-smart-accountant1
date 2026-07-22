// Lightweight, fully-local intent detection for the AI assistant.
// Predicts the voucher type from the user's natural-language input BEFORE
// any LLM call, so we can (a) skip the LLM entirely for unambiguous inputs
// and (b) ship only a tiny, context-isolated subset of ledgers/items to the
// model — drastically reducing tokens, latency and cost.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type VoucherIntent = "payment" | "receipt" | "sales" | "purchase";

type Rule = { intent: VoucherIntent; patterns: RegExp[] };

const RULES: Rule[] = [
  {
    intent: "payment",
    patterns: [
      /\bpaid\b/i,
      /\bpay(?:ing|ment)?\b/i,
      /\bremitt?ed\b/i,
      /\bcash\s+out\b/i,
      /\bgave\s+to\b/i,
      /\bsettled\b/i,
      /\btransfer(?:red)?\s+to\b/i,
    ],
  },
  {
    intent: "receipt",
    patterns: [
      /\breceived\b/i,
      /\bcollected\b/i,
      /\bdeposited\b/i,
      /\bcash\s+in\b/i,
      /\bgot\s+from\b/i,
      /\bcredited\s+by\b/i,
    ],
  },
  {
    intent: "sales",
    patterns: [
      /\bsold\b/i,
      /\bbilled\s+to\b/i,
      /\binvoice(?:d)?\s+to\b/i,
      /\braised\s+(?:an?\s+)?invoice\b/i,
      /\bsales?\s+to\b/i,
    ],
  },
  {
    intent: "purchase",
    patterns: [
      /\bbought\b/i,
      /\bpurchased?\b/i,
      /\breceived\s+from\s+supplier\b/i,
      /\bvendor\s+bill\b/i,
      /\bsupplier\s+invoice\b/i,
    ],
  },
];

// Read-only question phrases — we must NEVER draft a voucher when the user is
// just asking about existing books ("what is the cash balance ...", "show me
// receivables", "closing balance of ...", etc.). Without this guard, phrases
// like "cash in <party>" wrongly matched the receipt rule.
const READ_ONLY_QUESTION = /^\s*(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|show|list|tell|give|display|find|fetch|get|report|view|see|check|explain|summar[iy]se?)\b/i;
const READ_ONLY_TERMS = /\b(closing balance|opening balance|trial balance|balance sheet|balance as on|balance of|outstanding|receivable|payable|ageing|aging|statement of|ledger of|p&l|profit and loss|gross profit|net profit|how much|report|summary|total sales|total purchase|list of)\b/i;

export function detectVoucherIntent(text: string): VoucherIntent | null {
  if (!text) return null;
  // Skip when the user is asking a question about existing books rather than
  // recording a new transaction.
  if (READ_ONLY_QUESTION.test(text) || READ_ONLY_TERMS.test(text)) return null;
  // Score by number of matched patterns so "received from supplier" → purchase
  // beats the generic "received" → receipt rule.
  let best: { intent: VoucherIntent; score: number } | null = null;
  for (const r of RULES) {
    let s = 0;
    for (const p of r.patterns) if (p.test(text)) s++;
    if (s > 0 && (!best || s > best.score)) best = { intent: r.intent, score: s };
  }
  return best?.intent ?? null;
}

/**
 * Returns the minimal set of ledger types relevant to the intent. Used both
 * to scope DB fetches and to filter the in-memory masters cache.
 */
export function ledgerTypesForIntent(intent: VoucherIntent): string[] {
  switch (intent) {
    case "payment":
      return [
        "cash",
        "bank",
        "expense_direct",
        "expense_indirect",
        "sundry_creditor",
        "duties_taxes",
      ];
    case "receipt":
      return [
        "cash",
        "bank",
        "income_direct",
        "income_indirect",
        "sundry_debtor",
      ];
    case "sales":
      return ["sundry_debtor", "income_direct", "duties_taxes"];
    case "purchase":
      return [
        "sundry_creditor",
        "stock_in_hand",
        "expense_direct",
        "expense_indirect",
        "duties_taxes",
      ];
  }
}

export interface ContextLedger {
  id: string;
  name: string;
  type: string;
}

/**
 * Fetch ONLY the ledgers that are relevant to the predicted voucher intent.
 * RLS keeps us inside the active company. We cap the count to keep prompt
 * size small.
 */
export async function fetchContextLedgers(
  supabase: SupabaseClient<Database>,
  companyId: string,
  intent: VoucherIntent,
  cap = 60,
): Promise<ContextLedger[]> {
  const types = ledgerTypesForIntent(intent);
  const { data, error } = await supabase
    .from("ledgers")
    .select("id, name, type, is_active")
    .eq("company_id", companyId)
    .in("type", types as Database["public"]["Enums"]["ledger_type"][])
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(cap);
  if (error || !data) return [];
  return data.map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

/**
 * Map an intent to the voucher route path used by the app.
 */
export function intentToRoute(intent: VoucherIntent): string {
  return `/app/vouchers/new/${intent}`;
}

// -------- Prefill bridge: assistant → voucher form ---------------------------

export const ASSISTANT_PREFILL_KEY = "assistant-voucher-prefill";

export interface AssistantPrefill {
  voucherType: VoucherIntent;
  date?: string; // ISO YYYY-MM-DD
  partyLedgerId?: string;
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  amount?: number; // rupees
  narration?: string;
  refNo?: string;
}

export function writeAssistantPrefill(p: AssistantPrefill) {
  try {
    sessionStorage.setItem(ASSISTANT_PREFILL_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota */
  }
}

export function consumeAssistantPrefill(
  expected: VoucherIntent,
): AssistantPrefill | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ASSISTANT_PREFILL_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as AssistantPrefill;
    if (p.voucherType !== expected) return null;
    sessionStorage.removeItem(ASSISTANT_PREFILL_KEY);
    return p;
  } catch {
    return null;
  }
}

/**
 * After the form has prefilled itself, send focus to the primary "Save"
 * button so the operator only has to press Enter to commit the voucher.
 * The button is identified by `data-assistant-save` (preferred) or by the
 * aria-label "Save voucher" as a fallback.
 */
export function focusSaveButton(root: Document | HTMLElement = document) {
  // Defer one frame so the DOM has the latest state.
  requestAnimationFrame(() => {
    const el =
      (root.querySelector("[data-assistant-save]") as HTMLElement | null) ??
      (root.querySelector(
        'button[aria-label="Save voucher" i], button[type="submit"]',
      ) as HTMLElement | null);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}
