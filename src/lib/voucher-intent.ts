// src/lib/voucher-intent.ts
// Lightweight, fully-local intent detection for the AI assistant.
// Predicts the voucher type from the user's natural-language input BEFORE
// any LLM call, so we can (a) skip the LLM entirely for unambiguous inputs
// and (b) ship only a tiny, context-isolated subset of ledgers/items to the
// model — drastically reducing tokens, latency and cost.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// ═════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════════════════════

export type VoucherIntentType = "payment" | "receipt" | "sales" | "purchase";

export interface ParsedVoucherIntent {
  type: VoucherIntentType;
  amountPaise: number;
  primaryParty: string;
  bankOrCash: string;
  narration: string;
  date: string;
  confidence: number;
  missingFields: string[];
  additionalEntries?: Array<{
    ledger: string;
    amountPaise: number;
    isDebit: boolean;
  }>;
}

export interface ContextLedger {
  id: string;
  name: string;
  type: string;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTENT DETECTION RULES
// ═════════════════════════════════════════════════════════════════════════════

type Rule = { intent: VoucherIntentType; patterns: RegExp[] };

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
      /\bpay\s+(?:to|for)\b/i,
      /\bpaid\s+(?:to|for)\b/i,
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
      /\breceipt\s+from\b/i,
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
      /\bsell\s+to\b/i,
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
      /\bbuy\s+from\b/i,
    ],
  },
];

const READ_ONLY_QUESTION =
  /^\s*(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|show|list|tell|give|display|find|fetch|get|report|view|see|check|explain|summar[iy]se?)\b/i;
const READ_ONLY_TERMS =
  /\b(closing balance|opening balance|trial balance|balance sheet|balance as on|balance of|outstanding|receivable|payable|ageing|aging|statement of|ledger of|p&l|profit and loss|gross profit|net profit|how much|report|summary|total sales|total purchase|list of)\b/i;

// ═════════════════════════════════════════════════════════════════════════════
//  INTENT DETECTION
// ═════════════════════════════════════════════════════════════════════════════

export function detectVoucherIntent(text: string): VoucherIntentType | null {
  if (!text) return null;
  if (READ_ONLY_QUESTION.test(text) || READ_ONLY_TERMS.test(text)) return null;

  let best: { intent: VoucherIntentType; score: number } | null = null;
  for (const r of RULES) {
    let s = 0;
    for (const p of r.patterns) if (p.test(text)) s++;
    if (s > 0 && (!best || s > best.score)) best = { intent: r.intent, score: s };
  }
  return best?.intent ?? null;
}

export function isReadOnlyQuery(text: string): boolean {
  if (!text) return true;
  return READ_ONLY_QUESTION.test(text) || READ_ONLY_TERMS.test(text);
}

// ═════════════════════════════════════════════════════════════════════════════
//  LEDGER TYPE SCOPING
// ═════════════════════════════════════════════════════════════════════════════

export function ledgerTypesForIntent(intent: VoucherIntentType): string[] {
  switch (intent) {
    case "payment":
      return ["cash", "bank", "expense_direct", "expense_indirect", "sundry_creditor", "duties_taxes"];
    case "receipt":
      return ["cash", "bank", "income_direct", "income_indirect", "sundry_debtor"];
    case "sales":
      return ["sundry_debtor", "income_direct", "duties_taxes"];
    case "purchase":
      return ["sundry_creditor", "stock_in_hand", "expense_direct", "expense_indirect", "duties_taxes"];
  }
}

export async function fetchContextLedgers(
  supabase: SupabaseClient<Database>,
  companyId: string,
  intent: VoucherIntentType,
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

export function intentToRoute(intent: VoucherIntentType): string {
  return `/app/vouchers/new/${intent}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VOICE NORMALIZATION
// ═════════════════════════════════════════════════════════════════════════════

export function normalizeVoiceInput(text: string): string {
  return (
    text
      .replace(/\b(rupees|rs|are es)\b/gi, "₹")
      .replace(/\b(thousand|k)\b/gi, "000")
      .replace(/\b(lakh|lac)\b/gi, "00000")
      .replace(/\b(crore|cr)\b/gi, "0000000")
      .replace(/\b(point|dot)\b/gi, ".")
      .replace(/\b(zero|oh)\b/gi, "0")
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine)\s+thousand\b/gi, (_, digit) => {
        const map: Record<string, string> = {
          one: "1",
          two: "2",
          three: "3",
          four: "4",
          five: "5",
          six: "6",
          seven: "7",
          eight: "8",
          nine: "9",
        };
        return `${map[digit.toLowerCase()] || "1"}000`;
      })
      .replace(/\s+/g, " ")
      .trim()
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  ENTITY EXTRACTION
// ═════════════════════════════════════════════════════════════════════════════

function parseAmount(text: string): number | null {
  let normalized = text
    .replace(/,/g, "")
    .replace(/\b(thousand|k)\b/gi, "000")
    .replace(/\b(lakh|lac)\b/gi, "00000")
    .replace(/\b(crore|cr)\b/gi, "0000000")
    .replace(/\b(point|dot)\b/gi, ".");

  const match =
    normalized.match(/(?:₹|rs|rupees)?\s*(\d+(?:\.\d{1,2})?)/i) ||
    normalized.match(/\b(\d{4,})\b/);

  if (!match) return null;
  return Math.round(parseFloat(match[1]) * 100);
}

function parseDate(text: string): string {
  const today = new Date();
  if (/\btoday\b/i.test(text)) return today.toISOString().split("T")[0];
  if (/\byesterday\b/i.test(text)) {
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    return yest.toISOString().split("T")[0];
  }

  // Word-bounded so "15000" doesn't match as day 15
  const dayMatch = text.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (dayMatch) {
    const day = parseInt(dayMatch[1]);
    if (day >= 1 && day <= 31) {
      const date = new Date(today.getFullYear(), today.getMonth(), day);
      return date.toISOString().split("T")[0];
    }
  }

  const fullMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (fullMatch) {
    const [, d, m, y] = fullMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return today.toISOString().split("T")[0];
}

function extractParty(text: string, type: VoucherIntentType): string | null {
  const patterns: Record<VoucherIntentType, RegExp[]> = {
    payment: [
      /(?:paid|payment to|give to|sent to|transfer to|pay to)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
      /(?:to|for)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
    ],
    receipt: [
      /(?:received from|got from|collected from)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
      /(?:from)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
    ],
    sales: [
      /(?:sold to|sales to|invoice to|bill to)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
    ],
    purchase: [
      /(?:bought from|purchase from|from)\s+([A-Z][A-Za-z0-9\s&.,]{2,40})/i,
    ],
  };

  for (const pattern of patterns[type]) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractBankOrCash(text: string): string {
  const bankMatch = text.match(/\b(hdfc|sbi|icici|axis|pnb|bob|kotak|yes bank|union bank|canara|idbi)\b/i);
  if (bankMatch) {
    const name = bankMatch[1];
    return name.length <= 4 ? `${name.toUpperCase()} Bank` : name;
  }
  if (/\bcash\b/i.test(text)) return "Cash";
  if (/\bbank\b/i.test(text)) return "Bank";
  return "Cash";
}

function generateNarration(intent: ParsedVoucherIntent, originalText: string): string {
  const amount = `₹${(intent.amountPaise / 100).toFixed(2)}`;
  switch (intent.type) {
    case "payment":
      return `Payment of ${amount} to ${intent.primaryParty} via ${intent.bankOrCash}`;
    case "receipt":
      return `Receipt of ${amount} from ${intent.primaryParty} via ${intent.bankOrCash}`;
    case "sales":
      return `Sales of ${amount} to ${intent.primaryParty}`;
    case "purchase":
      return `Purchase of ${amount} from ${intent.primaryParty}`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN PARSER
// ═════════════════════════════════════════════════════════════════════════════

export function parseVoucherIntent(text: string): {
  intent: ParsedVoucherIntent | null;
  confidence: number;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  const type = detectVoucherIntent(text);
  if (!type) {
    return { intent: null, confidence: 0, missingFields: ["unrecognized intent"] };
  }

  const amountPaise = parseAmount(text);
  const primaryParty = extractParty(text, type);
  const bankOrCash = extractBankOrCash(text);
  const date = parseDate(text);

  if (!amountPaise) missingFields.push("amount");
  if (!primaryParty) missingFields.push("party");

  const confidence = missingFields.length === 0 ? 0.95 : missingFields.length === 1 ? 0.7 : 0.4;

  if (missingFields.length > 1) {
    return { intent: null, confidence, missingFields };
  }

  const intent: ParsedVoucherIntent = {
    type,
    amountPaise: amountPaise || 0,
    primaryParty: primaryParty || "Unknown Party",
    bankOrCash,
    date,
    confidence,
    missingFields,
    narration: "",
  };

  intent.narration = generateNarration(intent, text);
  return { intent, confidence, missingFields };
}

// ═════════════════════════════════════════════════════════════════════════════
//  PREFILL BRIDGE
// ═════════════════════════════════════════════════════════════════════════════

export const ASSISTANT_PREFILL_KEY = "assistant-voucher-prefill";

export interface AssistantPrefill {
  voucherType: VoucherIntentType;
  date?: string;
  partyLedgerId?: string;
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  amount?: number;
  narration?: string;
  refNo?: string;
}

export function writeAssistantPrefill(p: AssistantPrefill) {
  try {
    sessionStorage.setItem(ASSISTANT_PREFILL_KEY, JSON.stringify(p));
    void import("@/lib/ai/correction-watcher")
      .then((m) => m.armCorrectionWatch(p))
      .catch(() => undefined);
  } catch {
    /* ignore quota */
  }
}

export function consumeAssistantPrefill(expected: VoucherIntentType): AssistantPrefill | null {
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

export function focusSaveButton(root: Document | HTMLElement = document) {
  requestAnimationFrame(() => {
    const el =
      (root.querySelector("[data-assistant-save]") as HTMLElement | null) ??
      (root.querySelector('button[aria-label="Save voucher" i], button[type="submit"]') as HTMLElement | null);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}
