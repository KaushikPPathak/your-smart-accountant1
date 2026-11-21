import { BANK_ALIAS_PATTERN, findBankInText } from "./bank-aliases";
import type { AgingSide } from "./aging";
// src/lib/ai/query-router.ts
import type { StructuredCard } from "./sqliteContext";

export type IntentType =
  | "party_balance"
  | "cash_balance"
  | "bank_balance"
  | "trial_balance"
  | "voucher_lookup"
  | "voucher_create"
  | "comparison"
  | "explanation"
  | "greeting"
  | "ageing"
  | "gst_query"
  | "profit_loss"
  | "stock_query"
  | "party_ledger"
  | "date_range_report"
  | "party_summary"
  | "cash_bank_total"
  | "sales_total"
  | "bank_anomalies"
  | "cash_runway"
  | "credit_watch"
  | "customer_ranking"
  | "vendor_overdue"
  | "duplicate_check"
  | "vendor_concentration"
  | "monthly_trend"
  | "returns_summary"
  | "vendor_spend_cycle"
  | "unknown";

export interface RouteResult {
  intent: IntentType;
  confidence: number;
  requiresLLM: boolean;
  requiresTools: boolean;
  /** Set for analytical or report questions the local engine does not answer yet. */
  unsupportedReport?: boolean;
  entity?: {
    partyName?: string;
    dateRange?: { from?: string; to?: string };
    amount?: number;
    /** For party_summary: receivables (debtors) or payables (creditors). */
    summarySide?: AgingSide;
    voucherType?: "payment" | "receipt" | "journal" | "contra" | "sales" | "purchase";
    accountName?: string;
  };
  entityHints: string[];
  asOn?: string;
  from?: string;
  to?: string;
  latestKind?: "latest" | "year_end";
  balanceDateMode?: "latest" | "year_end" | "explicit";
  companyHint?: string;
  deterministicAnswer?: string | null;
}

// -----------------------------------------------------------------------------
// Intent patterns
// -----------------------------------------------------------------------------
// Balance routing is deliberately handled before generic party_balance routing.
// This prevents phrases such as "Bank of Baroda balance" from being mistaken
// for a party/ledger question.
const INTENT_PATTERNS: { intent: IntentType; patterns: RegExp[]; deterministic: boolean }[] = [
  {
    intent: "profit_loss",
    deterministic: false,
    patterns: [
      /(?:profit|loss|p&l|p\s+and\s+l|income statement)/i,
      /how much (?:did we make|is the profit|is the loss)/i,
    ],
  },
  {
    intent: "ageing",
    deterministic: false,
    patterns: [
      /(?:ageing|aging|receivables|payables|overdue|outstanding).{0,20}(?:90|60|30|days)/i,
      /who owes.{0,20}over/i,
    ],
  },
  {
    intent: "gst_query",
    deterministic: false,
    patterns: [
      /(?:gst|gstr|gstr-1|gstr-3b|input tax|itc|tax liability)/i,
      /gst summary/i,
    ],
  },
  {
    intent: "stock_query",
    deterministic: false,
    patterns: [
      /(?:stock|inventory|closing stock|items in hand)/i,
      /how much (?:stock|inventory)/i,
    ],
  },
  {
    intent: "party_ledger",
    deterministic: true,
    patterns: [
      /(?:ledger|statement|transactions|all entries).{0,30}(?:of|for)\b/i,
      /show ledger/i,
    ],
  },
  {
    intent: "date_range_report",
    deterministic: true,
    patterns: [
      /(?:sales|purchases|receipts|payments).{0,20}(?:in|during|for)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|last month|this month)/i,
      /journal book/i,
      /journal register/i,
      /show journals/i,
    ],
  },

  // IMPORTANT: cash and bank come before the generic party balance pattern.
  {
    intent: "cash_balance",
    deterministic: true,
    patterns: [
      /\bcash(?:[-\s]?in[-\s]?hand)?\b.{0,30}\b(?:balance|how much|status)\b/i,
      /\b(?:balance|status)\b.{0,25}\b(?:cash|cash[-\s]?in[-\s]?hand)\b/i,
      /\bhow much cash\b/i,
    ],
  },
  {
    intent: "bank_balance",
    deterministic: true,
    patterns: [
      // Explicit bank/account wording.
      /\bbank\b.{0,40}\b(?:balance|how much|status)\b/i,
      /\b(?:balance|how much|status)\b.{0,40}\b(?:in|of|for)\b.{0,30}\b(?:bank|account)\b/i,

      // Common Indian bank abbreviations/names. These deliberately require
      // a balance/account context, except for a bare bank-name query handled
      // separately in routeQuery().
      new RegExp(`\\b${BANK_ALIAS_PATTERN}\\b.{0,30}\\b(?:balance|how much|status)\\b`, "i"),
      new RegExp(`\\b(?:balance|how much|status)\\b.{0,30}\\b(?:in|of|for)\\b.{0,30}\\b${BANK_ALIAS_PATTERN}\\b`, "i"),
    ],
  },

  // Generic ledger/party balance. This is intentionally broad so the user
  // can ask for any ledger shown in the books/balance sheet, not only parties.
  {
    intent: "party_balance",
    deterministic: true,
    patterns: [
      /\b(?:balance|how much|what is)\b.{0,80}\b(?:party|ledger|account|customer|vendor|supplier)\b/i,
      /\b(?:how much|what)\b.{0,40}\b(?:owe|owes|due|outstanding|pending)\b.{0,40}\b(?:from|to|by)\b/i,
      /\b(?:show|get|tell)\b.{0,20}\bbalance\b.{0,80}\b(?:of|for|in)\b/i,
      /\bbalance\s+(?:of|for|in)\b/i,
      /\b(?:outstanding|balance)\b.{0,40}\bfor\s+[A-Za-z]/i,
      // Natural accounting questions such as "Hasmukhbhai balance" or
      // "Avni balance at year end".
      /\b(?:balance|bal)\b/i,
    ],
  },
  {
    intent: "trial_balance",
    deterministic: true,
    patterns: [
      /(?:trial balance|tb)/i,
      /\b(?:all|total)\s+(?:ledgers?|balances?)\b/i,
    ],
  },
  {
    intent: "voucher_lookup",
    deterministic: true,
    patterns: [
      /(?:show|find|get|list).{0,20}(?:voucher|entry|transaction|bill|invoice)/i,
      /(?:last|recent|previous).{0,10}(?:voucher|entry|payment|receipt)/i,
    ],
  },
  {
    intent: "voucher_create",
    deterministic: false,
    patterns: [
      /(?:create|make|add|record|post).{0,20}(?:voucher|entry|payment|receipt|journal)/i,
      /(?:paid|received|bought|sold).{0,30}(?:rs|rupees|₹|\d)/i,
      /(?:give|take|transfer|deposit|withdraw).{0,20}(?:money|cash|amount)/i,
    ],
  },
  {
    intent: "comparison",
    deterministic: false,
    patterns: [
      /(?:compare|vs|versus|difference|higher|lower|more|less).{0,30}(?:than|with|between)/i,
      /(?:why|how come).{0,20}(?:higher|lower|different|more|less)/i,
    ],
  },
  {
    intent: "explanation",
    deterministic: false,
    patterns: [
      /(?:why|how|explain|what does|what is|meaning|reason)/i,
      /(?:should|could|would|advise|suggest|recommend)/i,
    ],
  },
  {
    intent: "greeting",
    deterministic: true,
    patterns: [
      /^(?:hi|hello|hey|good morning|good afternoon|good evening|namaste)/i,
    ],
  },
];

// -----------------------------------------------------------------------------
// Normalisation / entity helpers
// -----------------------------------------------------------------------------

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripOuterPunctuation(value: string): string {
  return cleanSpaces(value)
    .replace(/^[\s,:;.!?\-]+/, "")
    .replace(/[\s,:;.!?\-]+$/, "")
    .trim();
}

function normalizeDate(day: number, month: number, year: number): string | undefined {
  let y = year;
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) return undefined;
  return `${String(y).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateToken(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
  if (!m) return undefined;

  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);

  // YYYY-MM-DD
  if (m[1].length === 4) return normalizeDate(a, b, c);
  // DD-MM-YYYY / DD-MM-YY
  return normalizeDate(a, b, c);
}

function financialYearEnd(fyText: string): string | undefined {
  const m = fyText.match(/(?:fy|financial\s*year)?\s*(20\d{2})\s*[-\/]\s*(\d{2}|20\d{2})/i);
  if (!m) return undefined;
  const startYear = Number(m[1]);
  const endPart = m[2];
  const endYear = endPart.length === 2 ? Number(`${String(startYear).slice(0, 2)}${endPart}`) : Number(endPart);
  return normalizeDate(31, 3, endYear);
}

interface DateInfo {
  from?: string;
  to?: string;
  yearEndRequested?: boolean;
  financialYear?: string;
}

function extractDateInfo(text: string): DateInfo {
  const out: DateInfo = {};
  const source = text.replace(/\b(balance sheet|balancesheet)\b/gi, " ");

  // Explicit single dates: "as on", "as of", "on", "at", "dated".
  const explicit = source.match(
    /\b(?:as\s+on|as\s+of|on|at|dated)\s+(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\b/i,
  );
  if (explicit) out.to = parseDateToken(explicit[1]);

  // Range: from DATE to DATE.
  const range = source.match(
    /\bfrom\s+(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\s+(?:to|till|until|through)\s+(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\b/i,
  );
  if (range) {
    out.from = parseDateToken(range[1]);
    out.to = parseDateToken(range[2]);
  } else {
    const from = source.match(/\b(?:from|since)\s+(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\b/i);
    if (from) out.from = parseDateToken(from[1]);

    const to = source.match(/\b(?:to|till|until|through)\s+(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\b/i);
    if (to) out.to = parseDateToken(to[1]);
  }

  // Financial year: FY 2025-26 / financial year 2025-26.
  const fy = source.match(/\b(?:fy|financial\s*year)\s*[:=]?\s*(20\d{2})\s*[-\/]\s*(\d{2}|20\d{2})\b/i);
  if (fy) {
    out.financialYear = `${fy[1]}-${fy[2]}`;
    if (!out.to) out.to = financialYearEnd(`${fy[1]}-${fy[2]}`);
  }

  // "year end", "year-end", "at year end", etc. Do not invent a date
  // when the financial year is not specified. latestKind lets downstream
  // code know that the user explicitly requested a year-end balance.
  if (/\b(?:at|as\s+at|as\s+of|on)?\s*(?:the\s+)?(?:year[\s-]?end|end\s+of\s+(?:the\s+)?year)\b/i.test(source)) {
    out.yearEndRequested = true;
  }

  // No explicit date means "latest/default balance". The router deliberately
  // does not invent a calendar date here: the active financial-year context
  // belongs to the accounting/retrieval layer. That layer should interpret
  // balanceDateMode="latest" as:
  //   - closed/non-current FY: year-end balance of the active FY
  //   - current/open FY: balance after the latest posted entry in that FY
  return out;
}

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REPORT_QUESTION = new RegExp(
  [
    "^\\s*(?:which|who are|are there|is there|do we have any)\\b",
    "^\\s*top\\s+(?:\\d+|ten|five|three)\\b",
    "\\b(?:abnormal|unusual|spikes?|out[- ]of[- ]pattern|reconcil\\w*|difference between|statement balance|book balance|balance sheet)\\b",
    "\\b(?:80\\s*%|accounts?\\s+payable|accounts?\\s+receivable|by revenue|by spend)\\b",
    "\\blist\\s+(?:all\\s+)?(?:customers|vendors|parties|debtors|creditors|items|stock)\\b",
  ].join("|"),
  "i",
);

/**
 * Receivables or payables across all parties ("total accounts receivable", "who owes us",
 * "top 10 vendors"). Questions about revenue, spend, a percentage share, or due dates in N days
 * are not answered this way, so they return null and fall through to the report guard.
 */
function partySummarySide(text: string): AgingSide | null {
  if (!/\b(?:total|top|list|which|who|all|outstanding|overdue|ageing|aging|buckets?|due|pending|owe|owes|owed)\b/i.test(text)) {
    return null;
  }
  if (/\b(?:revenue|spend|80\s*%|next\s+\d+\s+days|due\s+in|by\s+spend)\b/i.test(text)) return null;
  // Per-invoice, credit-limit, advance and debit-note questions need invoice-level data this summary does not have.
  if (/\b(?:invoices?|bills?\s+(?:are|is)|credit\s+limits?|debit\s+notes?|credit\s+notes?|advances?|unallocated|partially)\b/i.test(text)) return null;
  if (/\bfrom\s+[A-Z]/.test(text)) return null; // a named party is a party balance question
  if (/\b(?:accounts?\s+payable|payables?|creditors?|vendors?|suppliers?|we\s+owe)\b/i.test(text)) return "payable";
  if (/\b(?:accounts?\s+receivable|receivables?|debtors?|customers?|who\s+owes\s+(?:us|me)|owes\s+us)\b/i.test(text)) {
    return "receivable";
  }
  return null;
}

const BANK_NAME_LEAD_NOISE = new Set([
  "show", "give", "tell", "what", "whats", "what's", "is", "are", "the", "my", "our", "your", "me",
  "current", "check", "get", "see", "please", "of", "for", "in", "and", "to", "balance", "bal", "how", "much", "status",
  "yes", "yeah", "yep", "ok", "okay",
]);

function extractBankAccount(text: string): string | undefined {
  // Longest alias first, so "bank of baroda" wins over "bob" (see bank-aliases.ts).
  const known = findBankInText(text);
  if (known) return known;

  // Generic named-bank form: "ABC Bank balance" / "ABC bank".
  // Leading request words ("show", "what is the") are not part of the bank's name.
  const namedBank = text.match(/\b([A-Za-z][A-Za-z0-9&.'-]*(?:\s+[A-Za-z][A-Za-z0-9&.'-]*){0,5})\s+bank\b/i);
  if (namedBank) {
    const words = namedBank[1].split(/\s+/);
    while (words.length && BANK_NAME_LEAD_NOISE.has(words[0].toLowerCase())) words.shift();
    if (words.length) return stripOuterPunctuation(`${words.join(" ")} Bank`);
  }

  // Generic "account <name>" form. This is used only when the query is
  // explicitly about an account/bank, preventing ordinary party balances
  // from being classified as bank balances.
  const account = text.match(/\b(?:bank\s+account|account)\s+(?:of|for|named|called)?\s*([A-Za-z][A-Za-z0-9&.'-]*(?:\s+[A-Za-z][A-Za-z0-9&.'-]*){0,5})/i);
  if (account) {
    const candidate = stripOuterPunctuation(account[1])
      .replace(/\b(?:balance|status|today|now|at|on|as|of|from|year|end|date|sheet)\b.*$/i, "")
      .trim();
    if (candidate) return candidate;
  }

  return undefined;
}

function extractBalanceSubject(text: string): string | undefined {
  let value = text;

  // Remove date/range phrases first.
  value = value.replace(/\b(?:as\s+on|as\s+of|on|at|dated)\s+\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/gi, " ");
  value = value.replace(/\b(?:from|since|to|till|until|through)\s+\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/gi, " ");
  value = value.replace(/\b(?:fy|financial\s*year)\s*[:=]?\s*20\d{2}\s*[-\/]\s*(?:\d{2}|20\d{2})\b/gi, " ");
  value = value.replace(/\b(?:at|as\s+at|as\s+of|on)?\s*(?:the\s+)?(?:year[\s-]?end|end\s+of\s+(?:the\s+)?year)\b/gi, " ");

  // Remove accounting-context phrases that are not part of the ledger name.
  value = value.replace(/\b(?:from|as\s+per|as\s+shown\s+in|as\s+shown\s+on|in)\s+(?:the\s+)?balance\s*sheet\b/gi, " ");
  value = value.replace(/\b(?:balance\s*sheet|balancesheet)\b/gi, " ");

  // Remove question framing.
  value = value
    .replace(/^\s*(?:what(?:'s|\s+is)|what|how much|tell me|show me|give me|get me|show|get|tell)\b/gi, " ")
    .replace(/^\s*(?:the|my|our)\b/gi, " ")
    .replace(/\b(?:please|kindly)\b/gi, " ");

  // Honorifics are not part of the ledger name. Keep the actual name tokens
  // intact so a query such as "Shri Hasmukhbhai Shah balance" resolves to
  // the ledger whose first/last name tokens are Hasmukhbhai/Shah.
  value = value.replace(/\b(?:shri|smt|smti|mr|mrs|ms|miss|dr)\.?\b/gi, " ");

  // Remove the balance word and common trailing qualifiers.
  value = value
    .replace(/\b(?:balance|bal|amount|status)\b/gi, " ")
    .replace(/\b(?:total|outstanding|payment\s+history|history)\b/gi, " ")
    .replace(/^\s*and\b/i, " ")
    .replace(/\b(?:of|for|in|from|to|on|at|as|per)\b/gi, " ")
    .replace(/\b(?:today|now|current|present|particular|date|year|end|sheet)\b/gi, " ");

  // If a query contains an explicit "account"/"party" marker, use what
  // follows it as the subject.
  const marked = text.match(/\b(?:party|ledger|account|customer|vendor|supplier)\s+(?:named|called|of|for)?\s*([^?]+)$/i);
  if (marked) {
    value = marked[1];
    value = value
      .replace(/\b(?:balance|bal|amount|status|from|to|on|at|as|of|for|in)\b/gi, " ")
      .replace(/\b(?:balance\s*sheet|balancesheet)\b/gi, " ")
      .replace(/\b(?:year[\s-]?end|end\s+of\s+(?:the\s+)?year)\b/gi, " ")
      .replace(/\b(?:as\s+on|as\s+of)\b/gi, " ")
      .replace(/\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/g, " ");
  }

  value = value.replace(/[?.,:;]+/g, " ");
  value = value.replace(/\b(?:please|kindly|tell|show|give|get|me|my|our|the)\b/gi, " ");
  value = cleanSpaces(value);

  // Avoid returning pure filler.
  if (!value || /^(?:what|is|my|our|the|balance|sheet|year|end)$/i.test(value)) return undefined;

  return stripOuterPunctuation(value);
}

function extractEntities(text: string, intent?: IntentType): RouteResult["entity"] {
  const entity: NonNullable<RouteResult["entity"]> = {};
  const dateInfo = extractDateInfo(text);

  // Bank/account extraction MUST precede generic party extraction.
  if (intent === "bank_balance") {
    const accountName = extractBankAccount(text);
    if (accountName) entity.accountName = accountName;
  }

  // Generic balance subject. It is used for party_balance and can represent
  // any ledger/account in the books; retrieveParty() resolves it against the
  // actual ledger master.
  if (intent === "party_balance" || intent === "party_ledger") {
    const subject = extractBalanceSubject(text);
    if (subject) entity.partyName = subject;
  }

  // A bare number is an amount only after years and financial-year labels are removed
  // ("sales in 2025", "FY 2025-26", "31-03-2025"). Rupee-marked amounts are unaffected.
  const withoutYears = text
    .replace(/\bFY\s*\d{4}\s*[-/]\s*\d{2,4}\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
  const amountMatch =
    text.match(/(?:\b(?:rs|rupees)\.?|₹)\s*([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\b([\d,]+(?:\.\d{2})?)\s*(?:\brs\b|\brupees\b|₹)/i) ||
    withoutYears.match(/\b(\d{4,})\b/);
  if (amountMatch) {
    entity.amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  }

  if (dateInfo.from || dateInfo.to) {
    entity.dateRange = { from: dateInfo.from, to: dateInfo.to };
  }

  const voucherTypes = ["payment", "receipt", "journal", "contra", "sales", "purchase"] as const;
  for (const vt of voucherTypes) {
    if (new RegExp(`\\b${vt}\\b`, "i").test(text)) {
      entity.voucherType = vt;
      break;
    }
  }

  return Object.keys(entity).length > 0 ? entity : undefined;
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

/** "cash and bank balance", "total of cash and bank", "bank and cash across all accounts". */
function cashAndBankTotalQuestion(text: string): boolean {
  const both =
    /\bcash\b.{0,30}?\b(?:and|&|plus)\b.{0,30}?\bbank\b|\bbank\b.{0,30}?\b(?:and|&|plus)\b.{0,30}?\bcash\b/i.test(text);
  if (!both) return false;
  return /\b(?:balance|balances|total|totals|all|across|combined|overall|how much|current|today)\b/i.test(text);
}

/** Total sales for a period. Party-specific, register, trend and return questions go to other routes. */
function salesTotalQuestion(text: string): boolean {
  if (!/\bsales?\b/i.test(text)) return false;
  if (!/\b(?:total|gross|net|overall|how much)\b|\bsales?\s+(?:of|for|in|during)\b/i.test(text)) return false;
  if (
    /\b(?:register|list|customers?|parties|party|top|monthly|month|trend|growth|returns?|vouchers?|ledgers?|items?|products?|by|compare|vs|versus|ranking|margins?|profit|tax|gst|invoices?|credit|debit|outstanding|receivables?|purchases?|expenses?)\b/i.test(
      text,
    )
  )
    return false;
  // "sales of Ram Traders" names a party; "sales of 2025-26" and "sales of the year" do not.
  if (/\bsales?\s+(?:of|to|for|with|from)\s+(?!(?:the\s+)?(?:year|fy|financial|this|last|current|april|march|q[1-4]|quarter|month|day|today|yesterday|week)\b|\d)[a-z]/i.test(text))
    return false;
  // "sales in march 2026" is the month report's question (date_range_report), not the year total.
  if (/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(text))
    return false;
  return true;
}

/** "unusual spikes in the bank", "out-of-pattern withdrawals from cash". */
function bankAnomalyQuestion(text: string): boolean {
  return /\b(?:bank|cash)\b.{0,40}\b(?:unusual|spikes?|out[- ]of[- ]pattern|unexpected)\b|\b(?:unusual|spikes?|out[- ]of[- ]pattern)\b.{0,40}\b(?:bank|cash)\b/i.test(text);
}

/** "operating runway", "how many days of cash do we have", "burn rate". */
function cashRunwayQuestion(text: string): boolean {
  return /\b(?:runway|burn\s*rate|monthly\s+burn)\b|\bhow\s+(?:many|long)\b.{0,40}\b(?:days?|months?)\b.{0,40}\b(?:cash|funds|money)\b/i.test(text);
}

/** "customers past their credit limit", "overdue customers", "credit period". */
function creditWatchQuestion(text: string): boolean {
  if (/\b(?:credit\s+limits?|credit\s+period|credit\s+days)\b/i.test(text)) return true;
  if (/\b(?:top|revenue|ranking|by)\b/i.test(text)) return false;
  return /\b(?:customers?|debtors?|parties)\b.{0,40}\boverdue\b|\boverdue\b.{0,40}\b(?:customers?|debtors?)\b/i.test(text);
}

/** "top 10 customers", "largest debtors", "customers by revenue or overdue". */
function customerRankingQuestion(text: string): boolean {
  if (/\b(?:top|best|largest|biggest)\s+(?:\d+\s+)?(?:customers?|debtors?|parties)\b/i.test(text)) return true;
  return /\b(?:customers?|debtors?)\b.{0,30}\bby\s+(?:revenue|overdue|sales)\b/i.test(text);
}

/** "vendors with overdue balances", "unadjusted advances to suppliers", "debit notes to vendors". */
function duplicateCheckQuestion(text: string): boolean {
  return /\bduplicate\b|\bsame (bill|invoice) (no|number)\b|\bidentical amounts?\b|\bprice (jump|increase|hike|rise)s?\b|\bunusual (price|rate)s?\b|\bpaid twice\b|\brepeat(ed)? payments?\b/i.test(text);
}

function returnsSummaryQuestion(text: string): boolean {
  return /\b(purchase|sales) returns?\b|\breturn (value|values|summary|total)\b|\breturns? (this|the) (quarter|month|year)\b/i.test(text);
}

function monthlyTrendQuestion(text: string): boolean {
  return /\bmonth[- ]on[- ]month\b|\bmonthly\b.*\b(revenue|sales|expenses?|income|trend)\b|\b(revenue|sales|expenses?|income)\b.*\bmonthly\b|\btrend\b.*\b(revenue|sales|expenses?|income)\b/i.test(text);
}

function vendorConcentrationQuestion(text: string): boolean {
  if (!/\bvendors?\b|\bsuppliers?\b/i.test(text)) return false;
  return /\b80\s?%|\beighty percent\b|\bconcentration\b|\baccount for\b|\bshare of (our )?(purchase|spend)\b/i.test(text);
}

function vendorOverdueQuestion(text: string): boolean {
  return /\b(?:vendors?|suppliers?|creditors?)\b.{0,40}\b(?:overdue|unadjusted|advances?|debit\s+notes?)\b|\b(?:overdue|unadjusted|advances?|debit\s+notes?)\b.{0,40}\b(?:vendors?|suppliers?|creditors?)\b/i.test(text);
}

/** "total spend and average payment cycle for <vendor>", "days to pay <vendor>". */
function vendorSpendCycleQuestion(text: string): boolean {
  return /\bpayment\s+cycle\b|\bdays\s+to\s+pay\b|\baverage\s+payment\b|\bpayment\s+period\b/i.test(text);
}

/** The vendor named after "for", "of" or "with", ending before a period or a clause word. */
function vendorNameFromText(text: string): string | undefined {
  const m = /\b(?:for|of|with)\s+(.+?)(?:\s+(?:over|in|during|since|from|between|as\s+on|last|this|for\s+the)\b|[?.!,]|$)/i.exec(text);
  const name = m?.[1]?.trim();
  if (!name || /^(?:the\s+)?(?:last|this|past|current|previous)\b/i.test(name) || /^\d/.test(name)) return undefined;
  return name;
}

export function routeQuery(text: string, contextCard?: StructuredCard): RouteResult {
  const originalText = text ?? "";
  // "Yes, ..." / "Ok, ..." is an interjection. Without it, "Yes, show bank balance" reads as a
  // party called "Yes bank" and is promoted to YES Bank. "Yes bank balance" (no comma) still means YES Bank.
  const trimmed = originalText.trim().replace(/^(?:yes|yeah|yep|ok|okay)\s*[,.!;:-]\s*/i, "");

  if (vendorSpendCycleQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    const partyName = vendorNameFromText(trimmed);
    return {
      intent: "vendor_spend_cycle",
      confidence: 0.9,
      requiresLLM: false,
      requiresTools: true,
      entity: partyName ? { partyName } : {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (returnsSummaryQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "returns_summary",
      confidence: 0.9,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }
  if (monthlyTrendQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "monthly_trend",
      confidence: 0.9,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }
  if (vendorConcentrationQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "vendor_concentration",
      confidence: 0.9,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }
  if (duplicateCheckQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "duplicate_check",
      confidence: 0.9,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }
  if (vendorOverdueQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "vendor_overdue",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (customerRankingQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "customer_ranking",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (creditWatchQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "credit_watch",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (cashRunwayQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "cash_runway",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (bankAnomalyQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "bank_anomalies",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  // Totals across ledgers: all cash and bank, and sales for a period.
  if (cashAndBankTotalQuestion(trimmed) || salesTotalQuestion(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    const intent: IntentType = cashAndBankTotalQuestion(trimmed) ? "cash_bank_total" : "sales_total";
    // A bare financial year ("sales of 2025-26") is not picked up by extractDateInfo; read it here.
    const bareFy = /\b(20\d{2})\s*[-/]\s*(\d{2})\b/.exec(trimmed);
    const fyFrom = !dateInfo.from && bareFy ? `${bareFy[1]}-04-01` : undefined;
    const fyTo = !dateInfo.to && bareFy ? `${Number(bareFy[1]) + 1}-03-31` : undefined;
    const from = dateInfo.from ?? fyFrom;
    const to = dateInfo.to ?? fyTo;
    return {
      intent,
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: to,
      from,
      to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  // Who owes what, and how old it is: receivables or payables across all parties.
  const summarySide = partySummarySide(trimmed);
  if (summarySide) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "party_summary",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: { summarySide },
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  // Analytical and report questions ("which", "top 10", "abnormal", "reconcile", "accounts payable")
  // are not single-ledger balances. Say so plainly instead of guessing a balance.
  if (REPORT_QUESTION.test(trimmed)) {
    return { intent: "unknown", confidence: 0.5, requiresLLM: false, requiresTools: false, entityHints: [], unsupportedReport: true };
  }

  if (!trimmed) {
    return {
      intent: "unknown",
      confidence: 0,
      requiresLLM: true,
      requiresTools: false,
      entityHints: [],
    };
  }

  // 1. Greetings are instant.
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|namaste|hola)\b/i.test(trimmed)) {
    return {
      intent: "greeting",
      confidence: 1,
      requiresLLM: false,
      requiresTools: false,
      entityHints: [],
      deterministicAnswer:
        "Hello! I'm your AI accounting assistant. Ask me about balances, vouchers, or say something like 'Record a payment of ₹5000 to ABC Suppliers'.",
    };
  }

  // 2. Handle explicit cash/bank wording directly. This avoids the generic
  // party_balance regex winning merely because the query contains "balance".
  const bankAccount = extractBankAccount(trimmed);
  const hasBankContext = /\bbank\b|\bbank\s+account\b|\baccount\b/i.test(trimmed);
  const hasCashContext = /\bcash(?:[-\s]?in[-\s]?hand)?\b/i.test(trimmed);
  const hasBalanceContext = /\b(?:balance|bal|how much|status)\b/i.test(trimmed);
  const hasBankAlias = !!bankAccount && new RegExp(`\\b${BANK_ALIAS_PATTERN}\\b`, "i").test(trimmed);

  // "what is cash in hand", "cash in hand", "show cash" with no other words.
  const cashInHandOnly = /^\s*(?:(?:what(?:'s|\s+is)|how much(?:\s+is)?|show|check|tell me)\s+)?(?:the\s+)?cash(?:[-\s]?in[-\s]?hand)?\s*[?.!]*\s*$/i.test(trimmed);
  if ((hasCashContext && hasBalanceContext) || cashInHandOnly) {
    const entity = extractEntities(trimmed, "cash_balance");
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "cash_balance",
      confidence: 0.98,
      requiresLLM: false,
      requiresTools: true,
      entity,
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
      balanceDateMode: dateInfo.to ? "explicit" : dateInfo.yearEndRequested ? "year_end" : "latest",
      deterministicAnswer: undefined,
    };
  }

  // Named bank aliases are treated as bank balances when the question has
  // balance/account context. A bare "Bank of Baroda" is also accepted because
  // users commonly type the account name alone when asking for its balance.
  // "bank balance" with no bank named: all bank accounts. The engine uses the only bank
  // ledger, or reports that several exist.
  if (!bankAccount && /^\s*(?:(?:show|what(?:'s|\s+is)|check|my|the|current|please)\s+)*bank\s+(?:balance|bal)\b/i.test(trimmed)) {
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "bank_balance",
      confidence: 0.95,
      requiresLLM: false,
      requiresTools: true,
      entity: {},
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    };
  }

  if (bankAccount && (hasBalanceContext || hasBankContext || hasBankAlias)) {
    const entity = extractEntities(trimmed, "bank_balance") ?? {};
    entity.accountName = bankAccount;
    const dateInfo = extractDateInfo(trimmed);
    return {
      intent: "bank_balance",
      confidence: 0.98,
      requiresLLM: false,
      requiresTools: true,
      entity,
      entityHints: [],
      asOn: dateInfo.to,
      from: dateInfo.from,
      to: dateInfo.to,
      latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
      balanceDateMode: dateInfo.to ? "explicit" : dateInfo.yearEndRequested ? "year_end" : "latest",
      deterministicAnswer: undefined,
    };
  }

  // 3. Pattern matching for the remaining intents.
  let bestMatch: { intent: IntentType; confidence: number; deterministic: boolean } | null = null;

  for (const item of INTENT_PATTERNS) {
    // cash/bank were already handled above.
    if (item.intent === "cash_balance" || item.intent === "bank_balance") continue;

    for (const pattern of item.patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;

      const coverage = match[0].length / Math.max(1, trimmed.length);
      const confidence = Math.min(0.95, 0.6 + coverage * 0.4);

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { intent: item.intent, confidence, deterministic: item.deterministic };
      }
    }
  }

  // 4. Natural balance queries that contain a subject but did not match the
  // generic balance regex strongly enough.
  if (!bestMatch && hasBalanceContext) {
    const subject = extractBalanceSubject(trimmed);
    if (subject) {
      bestMatch = { intent: "party_balance", confidence: 0.88, deterministic: true };
    }
  }

  if (!bestMatch) {
    return {
      intent: "unknown",
      confidence: 0,
      requiresLLM: true,
      requiresTools: false,
      entityHints: [],
    };
  }

  const entity = extractEntities(trimmed, bestMatch.intent);
  const dateInfo = extractDateInfo(trimmed);

  // For generic ledger balances, entityHints should contain ONLY the actual
  // subject. This prevents dates / "balance sheet" / filler words from entering
  // fuzzy or semantic ledger resolution.
  const entityHints = entity?.partyName ? [entity.partyName] : [];

  // If the query is a generic "balance of X", but X is clearly a bank account,
  // promote it to bank_balance so the account-specific retriever is used.
  if (bestMatch.intent === "party_balance" && entity?.partyName) {
    const subjectBank = extractBankAccount(entity.partyName);
    if (subjectBank) {
      const bankEntity = { ...entity, accountName: subjectBank };
      delete bankEntity.partyName;
      return {
        intent: "bank_balance",
        confidence: Math.max(bestMatch.confidence, 0.95),
        requiresLLM: false,
        requiresTools: true,
        entity: bankEntity,
        entityHints: [],
        asOn: dateInfo.to,
        from: dateInfo.from,
        to: dateInfo.to,
        latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
        balanceDateMode: dateInfo.to ? "explicit" : dateInfo.yearEndRequested ? "year_end" : "latest",
        deterministicAnswer: undefined,
      };
    }
  }

  const canAnswerLocal =
    bestMatch.deterministic &&
    !!contextCard &&
    (bestMatch.intent === contextCard.kind ||
      (bestMatch.intent === "party_balance" && contextCard.kind === "party_balance"));

  return {
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    requiresLLM: !bestMatch.deterministic,
    requiresTools: bestMatch.deterministic && !canAnswerLocal,
    entity,
    entityHints,
    asOn: dateInfo.to,
    from: dateInfo.from,
    to: dateInfo.to,
    companyHint: undefined,
    latestKind: dateInfo.yearEndRequested ? "year_end" : "latest",
    balanceDateMode: dateInfo.to ? "explicit" : dateInfo.yearEndRequested ? "year_end" : "latest",
    deterministicAnswer: canAnswerLocal ? null : undefined,
  };
}

// Voice-specific: handle transcription artifacts.
export function normalizeVoiceInput(text: string): string {
  return text
    .replace(/\b(rupees|rs|are es)\b/gi, "₹")
    .replace(/\b(thousand|k)\b/gi, "000")
    .replace(/\b(lakh|lac)\b/gi, "00000")
    .replace(/\b(crore|cr)\b/gi, "0000000")
    .replace(/\b(point|dot)\b/gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}
