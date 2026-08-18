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
  | "unknown";


export interface RouteResult {
  intent: IntentType;
  confidence: number; // 0-1
  requiresLLM: boolean;
  requiresTools: boolean;
  entity?: {
    partyName?: string;
    dateRange?: { from?: string; to?: string };
    amount?: number;
    voucherType?: "payment" | "receipt" | "journal" | "contra" | "sales" | "purchase";
    accountName?: string;
  };
  entityHints: string[]; // Added back for retrievers/prefetch
  asOn?: string;         // Added back for retrievers
  from?: string;         // Added back for retrievers
  to?: string;           // Added back for retrievers
  latestKind?: string;   // Added back for retrievers
  companyHint?: string;  // Added back for retrievers
  deterministicAnswer?: string | null; // If local-first can handle it
}


// Fast regex-based intent detection — zero LLM latency
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
      /(?:ledger|statement|transactions|all entries).{0,20}(?:of|for)/i,
      /show ledger/i,
    ],
  },
  {
    intent: "date_range_report",
    deterministic: true,
    patterns: [
      /(?:sales|purchases|receipts|payments).{0,20}(?:in|during|for)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|last month|this month)/i,
    ],
  },
  {
    intent: "party_balance",
    deterministic: true,
    patterns: [
      /(?:balance|how much|what is).{0,30}(?:party|ledger|account|customer|vendor|supplier)/i,
      /(?:how much|what).{0,20}(?:owe|due|outstanding|pending).{0,20}(?:from|to|by)/i,
      /(?:show|get|tell).{0,10}(?:balance).{0,20}(?:of|for)/i,
      /balance of/i,
    ],
  },
  {
    intent: "cash_balance",
    deterministic: true,
    patterns: [
      /(?:cash|petty cash).{0,20}(?:balance|how much|status)/i,
      /how much cash/i,
    ],
  },
  {
    intent: "bank_balance",
    deterministic: true,
    patterns: [
      /(?:bank|account).{0,30}(?:balance|how much)/i,
      /(?:balance|status).{0,20}(?:in|of).{0,10}(?:bank|sbi|hdfc|icici)/i,
    ],
  },
  {
    intent: "trial_balance",
    deterministic: true,
    patterns: [
      /(?:trial balance|tb)/i,
      /(?:all|total).{0,20}(?:balance|ledger)/i,
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

// Entity extractors for deterministic intents
function extractEntities(text: string): RouteResult["entity"] {
  const entity: RouteResult["entity"] = {};
  
  // Party/Ledger name extraction
  const partyPatterns = [
    /(?:party|ledger|account|customer|vendor|supplier|from|to|of|for|balance of|ledger of)\s+([A-Z][A-Za-z0-9\s&]{2,40})/i,
    /([A-Z][A-Za-z0-9\s&]{2,40})(?:\s+(?:ledger|account|party|balance))/i,
  ];
  for (const p of partyPatterns) {
    const m = text.match(p);
    if (m) { entity.partyName = m[1].trim(); break; }
  }
  
  // Amount extraction
  const amountMatch = text.match(/(?:rs|rupees|₹)\s*([\d,]+(?:\.\d{2})?)/i) || 
                      text.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:rs|rupees|₹)/i) ||
                      text.match(/\b(\d{4,})\b/); // Large numbers likely amounts
  if (amountMatch) {
    entity.amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  }
  
  // Date range extraction
  const datePatterns = [
    /(?:from|since)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /(?:to|till|until)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /(?:as on|as of)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /(?:this|last|previous)\s+(?:month|week|quarter|year)/i,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b\d{4}\b/,
  ];
  
  // Voucher type
  const voucherTypes = ["payment", "receipt", "journal", "contra", "sales", "purchase"] as const;
  for (const vt of voucherTypes) {
    if (text.toLowerCase().includes(vt)) {
      entity.voucherType = vt;
      break;
    }
  }
  
  return Object.keys(entity).length > 0 ? entity : undefined;
}

export function routeQuery(text: string, contextCard?: StructuredCard): RouteResult {
  const lowerText = text.toLowerCase().trim();
  
  // 1. Check for greetings (instant)
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|namaste|hola)/i.test(text.trim())) {
    return {
      intent: "greeting",
      confidence: 1,
      requiresLLM: false,
      requiresTools: false,
      entityHints: [],
      deterministicAnswer: "Hello! I'm your AI accounting assistant. Ask me about balances, vouchers, or say something like 'Record a payment of ₹5000 to ABC Suppliers'."
    };
  }

  
  // 2. Pattern matching for intent
  let bestMatch: { intent: IntentType; confidence: number; deterministic: boolean } | null = null;
  
  for (const item of INTENT_PATTERNS) {
    for (const pattern of item.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Calculate confidence based on match length vs query length
        const coverage = match[0].length / text.length;
        const confidence = Math.min(0.95, 0.6 + coverage * 0.4);
        
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { intent: item.intent, confidence, deterministic: item.deterministic };
        }
      }
    }
  }
  
  // 3. If no pattern match, default to unknown → LLM
  if (!bestMatch) {
    return {
      intent: "unknown",
      confidence: 0,
      requiresLLM: true,
      requiresTools: false,
      entityHints: [],
    };
  }

  
  // 4. Extract entities
  const entity = extractEntities(text);
  
  // 5. Determine if we can answer deterministically
  const canAnswerLocal = bestMatch.deterministic && contextCard && 
    (bestMatch.intent === contextCard.kind || 
     (bestMatch.intent === "party_balance" && contextCard.kind === "party_balance"));
  
  return {
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    requiresLLM: !bestMatch.deterministic,
    requiresTools: bestMatch.deterministic && !canAnswerLocal, // Need to fetch data
    entity,
    entityHints: entity?.partyName ? [entity.partyName] : [],
    asOn: entity?.dateRange?.to,
    from: entity?.dateRange?.from,
    to: entity?.dateRange?.to,
    companyHint: undefined,
    latestKind: entity?.voucherType,
    deterministicAnswer: canAnswerLocal ? null : undefined, // Will be filled after tool call
  };
}



// Voice-specific: handle transcription artifacts
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
