// src/lib/ai/voucher-actions.ts
// Phase 2 — Draft-first write actions + validated double-entry execution.
//
// Fully-local natural-language → voucher draft parser + executor.
// Unambiguous voice commands like:
//   "receive 50000 from Madhuben in SBI on 15/03"
//   "pay 12000 rent to landlord cash today"
//   "reverse voucher #142"
//   "duplicate yesterday's sales invoice for today"
// resolve to a fully-populated preview card without any network round-trip.
// The user just presses Enter to commit.

import { readLedgers, readVouchers } from "@/lib/offline/cache-read";
import { scoreNameMatch } from "./phonetic";
import type { VoucherIntentType, ParsedVoucherIntent, AssistantPrefill } from "@/lib/voucher-intent";
import { detectVoucherIntent as detectIntent, normalizeVoiceInput, parseVoucherIntent, writeAssistantPrefill } from "@/lib/voucher-intent";
import { invalidateToolCache } from "./tools";
import { openDB, DBSchema, IDBPDatabase } from "idb";

// ═════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface VoucherEntry {
  ledger_id: string;
  ledger_name: string;
  debit_paise: number;
  credit_paise: number;
}

export interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  voucher_type: VoucherIntentType | "journal" | string;
  narration: string;
  party_ledger_id?: string;
  total_amount_paise: number;
  entries: VoucherEntry[];
  is_reversal?: boolean;
  source_voucher_id?: string;
  ref_no?: string;
  created_at: number;
}

export interface LocalVoucherDraft {
  intent: VoucherIntentType;
  date: string; // YYYY-MM-DD
  amount: number; // rupees (NOT paise here — kept for UI compatibility)
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
}

export type VoucherActionKind = "new" | "reverse" | "duplicate" | "journal";

export interface VoucherAction {
  kind: VoucherActionKind;
  draft: LocalVoucherDraft;
  confidence: number;
  source?: {
    number?: string;
    date: string;
    type: string;
    id?: string;
  };
}

export interface VoucherExecutionResult {
  success: boolean;
  voucher?: Voucher;
  error?: string;
  confirmationRequired?: boolean;
  confirmationMessage?: string;
  prefill?: AssistantPrefill;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const GST_THRESHOLD_PAise = 250000; // ₹2,500 — adjust as needed
const CONFIRMATION_THRESHOLD_PAise = 1000000; // ₹10,000
const HIGH_CONFIDENCE = 0.85;

// Words that indicate the phrase is *not* a party/account name.
const STOP_WORDS = new Set([
  "the","a","an","of","for","to","from","in","on","by","via","through","into",
  "cash","bank","today","yesterday","tomorrow","account","acct","paid","paying",
  "pay","received","receive","sold","bought","reverse","duplicate","invoice",
  "voucher","and","with","against","dated","rs","rupees","rupee","amount",
]);

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function generateVoucherNumber(type: string, existing: any[]): string {
  const prefix = type.slice(0, 3).toUpperCase();
  const count = existing.filter((v) => String(v.voucher_type) === type).length + 1;
  return `${prefix}-${String(count).padStart(4, "0")}`;
}

function cleanPhrase(s: string): string {
  return s.replace(/[^A-Za-z0-9 &.\-]/g, " ").trim().replace(/\s+/g, " ");
}

// ═════════════════════════════════════════════════════════════════════════════
//  DATE PARSING (enhanced for voice)
// ═════════════════════════════════════════════════════════════════════════════

export function parseDate(text: string, today = new Date()): { date: string; matchedText?: string } | null {
  const t = text.toLowerCase();

  if (/\btoday\b/.test(t)) return { date: iso(today), matchedText: "today" };
  if (/\byesterday\b/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() - 1);
    return { date: iso(d), matchedText: "yesterday" };
  }
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    return { date: iso(d), matchedText: "tomorrow" };
  }
  if (/\bday\s+before\s+yesterday\b/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() - 2);
    return { date: iso(d), matchedText: "day before yesterday" };
  }

  // 15/03/2026, 15-03-26, 15.03.2026
  let m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = +m[3]; if (yy < 100) yy += 2000;
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }

  // 15/03 or 15-03 (assume current year)
  m = t.match(/\b(?:on\s+)?(\d{1,2})[\/\-.](\d{1,2})\b(?!\s*[:.])/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    const yy = today.getFullYear();
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }

  // 15 Mar 2026 / 15th March / March 15 2026
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{2,4}))?\b/);
  if (m && MONTHS[m[2]]) {
    const dd = +m[1], mm = MONTHS[m[2]];
    let yy = m[3] ? +m[3] : today.getFullYear();
    if (yy < 100) yy += 2000;
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }

  // "March 15" or "March 15th"
  m = t.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2,4}))?\b/);
  if (m && MONTHS[m[1]]) {
    const mm = MONTHS[m[1]], dd = +m[2];
    let yy = m[3] ? +m[3] : today.getFullYear();
    if (yy < 100) yy += 2000;
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  AMOUNT PARSING (voice-enhanced)
// ═════════════════════════════════════════════════════════════════════════════

export function parseAmount(text: string): number | null {
  // Dates (15/08/2026) must not supply the amount, and Indian grouping
  // ("50,0000", "1,50,000") must read as one number.
  const noDates = text.replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, " ");
  const cleaned = noDates.replace(/₹/g, " ").replace(/(\d),(?=\d)/g, "$1").replace(/,/g, " ");

  // Spoken lakh/crore: "1.5 lakh", "2 crore", "50k"
  const lakh = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(lakh|lac)s?\b/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  const cr = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(cr|crore)s?\b/i);
  if (cr) return Math.round(parseFloat(cr[1]) * 10000000);
  const k = cleaned.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) return Math.round(parseFloat(k[1]) * 1000);

  // Handle "one lakh fifty thousand" → 150000 (basic compound)
  const compound = parseCompoundAmount(cleaned);
  if (compound) return compound;

  // Plain number — pick the largest to avoid "#142" competing with "50000".
  const nums = Array.from(cleaned.matchAll(/\b(\d{2,}(?:\.\d+)?)\b/g)).map((x) => parseFloat(x[1]));
  if (!nums.length) return null;
  return Math.max(...nums);
}

function parseCompoundAmount(text: string): number | null {
  const t = text.toLowerCase();
  const numWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };

  let total = 0;
  let current = 0;

  const tokens = t.split(/\s+/);
  for (const token of tokens) {
    const val = numWords[token];
    if (val !== undefined) {
      current += val;
    } else if (token === "hundred" && current > 0) {
      current *= 100;
    } else if (token === "thousand") {
      current *= 1000;
      total += current;
      current = 0;
    } else if (token === "lakh" || token === "lac") {
      current *= 100000;
      total += current;
      current = 0;
    } else if (token === "crore" || token === "cr") {
      current *= 10000000;
      total += current;
      current = 0;
    }
  }
  total += current;
  return total > 0 ? total : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  LEDGER RESOLUTION (with session cache)
// ═════════════════════════════════════════════════════════════════════════════

interface CachedLedger { id: string; name: string; type: string }

let _ledgerCache: { companyId: string; ledgers: CachedLedger[]; ts: number } | null = null;
const LEDGER_CACHE_TTL = 30000; // 30s

async function getCachedLedgers(companyId: string): Promise<CachedLedger[]> {
  if (_ledgerCache && _ledgerCache.companyId === companyId && Date.now() - _ledgerCache.ts < LEDGER_CACHE_TTL) {
    return _ledgerCache.ledgers;
  }
  const ledgers = (await readLedgers(companyId)) as CachedLedger[];
  _ledgerCache = { companyId, ledgers, ts: Date.now() };
  return ledgers;
}

export function invalidateLedgerCache(): void {
  _ledgerCache = null;
}

function pickBest(
  ledgers: CachedLedger[],
  phrase: string,
  typeFilter?: (t: string) => boolean,
  threshold = 0.7,
): CachedLedger | null {
  if (!phrase) return null;
  const pool = typeFilter ? ledgers.filter((l) => typeFilter(l.type)) : ledgers;
  let best: { l: CachedLedger; score: number } | null = null;
  for (const l of pool) {
    const s = scoreNameMatch(l.name, phrase).score;
    if (s >= threshold && (!best || s > best.score)) best = { l, score: s };
  }
  return best?.l ?? null;
}

const CASH_RE = /\b(cash)\b/i;
const BANK_RE = /\b(?:in|via|through|to|from|into)\s+([A-Za-z][A-Za-z0-9 &.\-]{1,40}?)\b(?=\s*(?:on|dated|today|yesterday|tomorrow|for|against|by|,|\.|\d|$))/i;

function normalizeLedgerText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Finds the ledger whose complete name appears as whole words in the text.
 * The longest matching name wins. Exact word matches only, so no guessing.
 */
export function findLedgerNamedInText(
  ledgers: CachedLedger[],
  text: string,
  typeFilter?: (t: string) => boolean,
  exclude: string[] = [],
): CachedLedger | null {
  const hay = ` ${normalizeLedgerText(text)} `;
  let best: CachedLedger | null = null;
  let bestLen = 0;
  for (const l of ledgers) {
    if (typeFilter && !typeFilter(l.type)) continue;
    if (exclude.includes(l.id)) continue;
    const n = normalizeLedgerText(l.name);
    if (n.length < 3 || n.length <= bestLen) continue;
    if (hay.includes(` ${n} `)) {
      best = l;
      bestLen = n.length;
    }
  }
  return best;
}

function extractPartyPhrase(text: string, intent: VoucherIntentType): string | null {
  const primary = intent === "receipt" || intent === "purchase" ? /\bfrom\s+/i : /\bto\s+/i;
  const fallback = /\b(?:to|from|for)\s+/i;
  for (const re of [primary, fallback]) {
    const idx = text.search(re);
    if (idx < 0) continue;
    const after = text.slice(idx).replace(re, "");
    const cut = after.split(/\b(?:in|via|through|on|dated|today|yesterday|tomorrow|for|against|by|cash|,)\b/i)[0];
    const words = cleanPhrase(cut).split(" ").filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
    if (words.length) return words.slice(0, 5).join(" ");
  }
  return null;
}

function extractBankPhrase(text: string): string | null {
  const m = text.match(BANK_RE);
  if (!m) return null;
  const words = cleanPhrase(m[1]).split(" ").filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  return words.length ? words.join(" ") : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  REVERSE / DUPLICATE DETECTION
// ═════════════════════════════════════════════════════════════════════════════

const REVERSE_RE = /\breverse\s+(?:voucher\s+)?#?\s*([A-Za-z0-9\-\/]+)/i;
const DUPLICATE_RE = /\b(?:duplicate|copy|repeat|clone)\b/i;

async function findVoucherByNumber(companyId: string, number: string): Promise<any | null> {
  const all = (await readVouchers(companyId)) as any[];
  const needle = number.replace(/^#/, "").toLowerCase();
  return all.find((v) => String(v.voucher_number ?? "").toLowerCase() === needle) ?? null;
}

function oppositeIntent(intent: VoucherIntentType): VoucherIntentType {
  switch (intent) {
    case "payment": return "receipt";
    case "receipt": return "payment";
    default: return intent;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN PARSER: text → VoucherAction draft
// ═════════════════════════════════════════════════════════════════════════════

export async function detectVoucherAction(
  text: string,
  companyId: string,
  today = new Date(),
): Promise<VoucherAction | null> {
  const raw = normalizeVoiceInput(text).trim();
  if (!raw) return null;

  // --- Reverse ------------------------------------------------------------
  const revMatch = raw.match(REVERSE_RE);
  if (revMatch) {
    const v = await findVoucherByNumber(companyId, revMatch[1]);
    if (!v) return null;
    const srcIntent = (String(v.voucher_type) as VoucherIntentType) ?? "payment";
    const revIntent = oppositeIntent(srcIntent);
    const amt = Number(v.total_amount_paise ?? v.total_paise ?? 0) / 100;
    const ledgers = await getCachedLedgers(companyId);
    const party = v.party_ledger_id ? ledgers.find((l) => l.id === v.party_ledger_id) : null;

    return {
      kind: "reverse",
      confidence: 0.95,
      source: { number: v.voucher_number, date: v.voucher_date, type: v.voucher_type, id: v.id },
      draft: {
        intent: revIntent,
        date: iso(today),
        amount: amt,
        amountPaise: Math.round(amt * 100),
        narration: `Reversal of ${srcIntent} voucher #${v.voucher_number} dated ${v.voucher_date}${v.narration ? ` — ${v.narration}` : ""}`,
        refNo: `REV-${v.voucher_number}`,
        partyLedgerId: party?.id,
        displayDetails: { partyName: party?.name },
      },
    };
  }

  // --- Duplicate ----------------------------------------------------------
  if (DUPLICATE_RE.test(raw)) {
    const intent = detectIntent(raw) ?? inferIntentFromText(raw);
    if (!intent) return null;

    const numMatch = raw.match(/#\s*([A-Za-z0-9\-\/]+)/);
    const targetDate = parseDate(raw, today)?.date ?? iso(today);
    let source: any = null;

    if (numMatch) {
      source = await findVoucherByNumber(companyId, numMatch[1]);
    } else {
      const sourceDayMatch = raw.match(/\b(yesterday|today|last\s+week)\b/i);
      let sourceDate = iso(today);
      if (sourceDayMatch) {
        const d = new Date(today);
        if (/yesterday/i.test(sourceDayMatch[1])) d.setDate(d.getDate() - 1);
        else if (/last\s+week/i.test(sourceDayMatch[1])) d.setDate(d.getDate() - 7);
        sourceDate = iso(d);
      }
      const all = (await readVouchers(companyId)) as any[];
      source = all.find((v) =>
        String(v.voucher_type) === intent &&
        String(v.voucher_date) === sourceDate
      ) ?? null;
    }

    if (!source) return null;
    const amt = Number(source.total_amount_paise ?? source.total_paise ?? 0) / 100;
    const ledgers = await getCachedLedgers(companyId);
    const party = source.party_ledger_id ? ledgers.find((l) => l.id === source.party_ledger_id) : null;

    return {
      kind: "duplicate",
      confidence: 0.9,
      source: { number: source.voucher_number, date: source.voucher_date, type: source.voucher_type, id: source.id },
      draft: {
        intent,
        date: targetDate,
        amount: amt,
        amountPaise: Math.round(amt * 100),
        narration: source.narration ? `${source.narration} (copy of #${source.voucher_number})` : `Copy of #${source.voucher_number}`,
        partyLedgerId: party?.id,
        displayDetails: { partyName: party?.name },
      },
    };
  }

  // --- New voucher (fully local) -----------------------------------------
  const intent = detectIntent(raw);
  if (!intent) {
    // Fallback: try the structured parser from voucher-intent.ts
    const parsed = parseVoucherIntent(raw);
    if (parsed.intent && parsed.confidence >= 0.7) {
      return buildActionFromParsed(parsed.intent, companyId, raw);
    }
    return null;
  }

  const amount = parseAmount(raw);
  if (!amount) return null;

  const dateRes = parseDate(raw, today);
  const date = dateRes?.date ?? iso(today);
  const ledgers = await getCachedLedgers(companyId);

  // Cash or bank?
  const usesCash = CASH_RE.test(raw);
  const bankPhrase = usesCash ? null : extractBankPhrase(raw);
  const bankType = (t: string) => t === "bank" || t === "cash";
  // The phrase after "in/from/to" is not always the bank (e.g. "paid to X from bank of baroda"),
  // so fall back to an exact bank or cash ledger name anywhere in the sentence.
  const cashBank = usesCash
    ? pickBest(ledgers, "cash", (t) => t === "cash", 0.9)
    : ((bankPhrase ? pickBest(ledgers, bankPhrase, bankType) : null)
        ?? findLedgerNamedInText(ledgers, raw, bankType));

  // Party: an exact ledger name in the sentence first (never a fuzzy match over an
  // exact one), then the phrase after from/to, then a fuzzy match as last resort.
  const partyTypes = intent === "receipt" || intent === "sales"
    ? (t: string) => t === "sundry_debtor" || t === "income_direct" || t === "income_indirect"
    : (t: string) => t === "sundry_creditor" || t === "expense_direct" || t === "expense_indirect";
  const partyExclude = cashBank ? [cashBank.id] : [];
  const partyPhrase = extractPartyPhrase(raw, intent);
  let party: CachedLedger | null = findLedgerNamedInText(ledgers, raw, partyTypes, partyExclude)
    ?? findLedgerNamedInText(ledgers, raw, undefined, partyExclude);
  if (!party && partyPhrase) {
    party = pickBest(ledgers, partyPhrase, partyTypes) ?? pickBest(ledgers, partyPhrase);
  }

  const confidence = 0.4 + (party ? 0.3 : 0) + (cashBank ? 0.2 : 0) + (dateRes ? 0.1 : 0);

  return {
    kind: "new",
    confidence,
    draft: {
      intent,
      date,
      amount,
      amountPaise: Math.round(amount * 100),
      narration: raw,
      partyLedgerId: party?.id,
      cashBankLedgerId: cashBank?.id,
      displayDetails: {
        partyName: party?.name ?? partyPhrase ?? undefined,
        accountName: cashBank?.name ?? (usesCash ? "Cash" : bankPhrase ?? undefined),
      },
    },
  };
}

function buildActionFromParsed(intent: ParsedVoucherIntent, companyId: string, raw: string): VoucherAction | null {
  return {
    kind: "new",
    confidence: intent.confidence,
    draft: {
      intent: intent.type,
      date: intent.date,
      amount: intent.amountPaise / 100,
      amountPaise: intent.amountPaise,
      narration: intent.narration || raw,
      partyLedgerId: undefined, // Would need ledger lookup
      cashBankLedgerId: undefined,
      displayDetails: {
        partyName: intent.primaryParty,
        accountName: intent.bankOrCash,
      },
    },
  };
}

function inferIntentFromText(t: string): VoucherIntentType | null {
  if (/\bsales?\s+invoice\b/i.test(t)) return "sales";
  if (/\bpurchase\s+invoice\b/i.test(t)) return "purchase";
  if (/\breceipt\b/i.test(t)) return "receipt";
  if (/\bpayment\b/i.test(t)) return "payment";
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOUBLE-ENTRY BUILDER
// ═════════════════════════════════════════════════════════════════════════════

export function buildVoucherEntries(
  action: VoucherAction,
  ledgers: CachedLedger[],
): VoucherEntry[] {
  const { draft, kind } = action;
  const amountPaise = draft.amountPaise;
  const entries: VoucherEntry[] = [];

  // Resolve ledger names
  const partyLedger = ledgers.find((l) => l.id === draft.partyLedgerId);
  const cashBankLedger = ledgers.find((l) => l.id === draft.cashBankLedgerId);
  const partyName = partyLedger?.name ?? draft.displayDetails.partyName ?? "Unknown Party";
  const cashBankName = cashBankLedger?.name ?? draft.displayDetails.accountName ?? "Cash";

  if (kind === "reverse" && action.source) {
    // For reversal, swap debits and credits
    // We need the original entries — fetch them if available
    // Fallback: simple reversal based on type
    switch (draft.intent) {
      case "receipt": // Original was payment → reverse: Dr Bank, Cr Party
        entries.push(
          { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: 0, credit_paise: amountPaise }
        );
        break;
      case "payment": // Original was receipt → reverse: Dr Party, Cr Bank
        entries.push(
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: 0, credit_paise: amountPaise }
        );
        break;
      default:
        entries.push(
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: 0, credit_paise: amountPaise }
        );
    }
    return entries;
  }

  if (kind === "duplicate") {
    // Duplicate keeps same entry structure — we'll rebuild from intent
    // This is a simplified version; ideally copy original entries
    switch (draft.intent) {
      case "sales":
        entries.push(
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: "sales", ledger_name: "Sales Account", debit_paise: 0, credit_paise: amountPaise }
        );
        break;
      case "purchase":
        entries.push(
          { ledger_id: "purchase", ledger_name: "Purchase Account", debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: 0, credit_paise: amountPaise }
        );
        break;
      case "receipt":
        entries.push(
          { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: 0, credit_paise: amountPaise }
        );
        break;
      case "payment":
      default:
        entries.push(
          { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
          { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: 0, credit_paise: amountPaise }
        );
    }
    return entries;
  }

  // --- New voucher entries ---
  switch (draft.intent) {
    case "payment":
      entries.push(
        { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
        { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: 0, credit_paise: amountPaise }
      );
      break;

    case "receipt":
      entries.push(
        { ledger_id: cashBankLedger?.id ?? "cash", ledger_name: cashBankName, debit_paise: amountPaise, credit_paise: 0 },
        { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: 0, credit_paise: amountPaise }
      );
      break;

    case "sales": {
      entries.push(
        { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: amountPaise, credit_paise: 0 },
        { ledger_id: "sales", ledger_name: "Sales Account", debit_paise: 0, credit_paise: amountPaise }
      );
      // Auto GST for high-value sales
      if (amountPaise > GST_THRESHOLD_PAise) {
        const gstPaise = Math.round(amountPaise * 0.09); // 9% each
        entries[0].debit_paise += gstPaise * 2; // Party pays total including GST
        entries.push(
          { ledger_id: "output_cgst", ledger_name: "Output CGST", debit_paise: 0, credit_paise: gstPaise },
          { ledger_id: "output_sgst", ledger_name: "Output SGST", debit_paise: 0, credit_paise: gstPaise }
        );
      }
      break;
    }

    case "purchase": {
      entries.push(
        { ledger_id: "purchase", ledger_name: "Purchase Account", debit_paise: amountPaise, credit_paise: 0 },
        { ledger_id: partyLedger?.id ?? "party", ledger_name: partyName, debit_paise: 0, credit_paise: amountPaise }
      );
      // Auto GST for high-value purchases
      if (amountPaise > GST_THRESHOLD_PAise) {
        const gstPaise = Math.round(amountPaise * 0.09);
        entries[0].debit_paise += gstPaise * 2;
        entries.push(
          { ledger_id: "input_cgst", ledger_name: "Input CGST", debit_paise: gstPaise, credit_paise: 0 },
          { ledger_id: "input_sgst", ledger_name: "Input SGST", debit_paise: gstPaise, credit_paise: 0 }
        );
      }
      break;
    }
  }

  return entries;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

export function validateDoubleEntry(entries: VoucherEntry[]): { valid: boolean; error?: string } {
  const totalDebit = entries.reduce((s, e) => s + e.debit_paise, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit_paise, 0);

  if (totalDebit !== totalCredit) {
    return {
      valid: false,
      error: `Double entry imbalance: Dr ₹${totalDebit / 100} ≠ Cr ₹${totalCredit / 100}`,
    };
  }
  if (totalDebit === 0) {
    return { valid: false, error: "Voucher amount cannot be zero" };
  }
  if (entries.length < 2) {
    return { valid: false, error: "A voucher needs at least two ledger entries" };
  }
  return { valid: true };
}

// ═════════════════════════════════════════════════════════════════════════════
//  PERSISTENCE (IndexedDB)
// ═════════════════════════════════════════════════════════════════════════════

interface VoucherDB extends DBSchema {
  vouchers: {
    key: string;
    value: Voucher;
  };
  undo_stack: {
    key: string;
    value: { id: string; voucher: Voucher; ts: number };
  };
}

let _voucherDB: Promise<IDBPDatabase<VoucherDB>> | null = null;

function getVoucherDB(): Promise<IDBPDatabase<VoucherDB>> {
  if (!_voucherDB) {
    _voucherDB = openDB<VoucherDB>("ai-vouchers", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("vouchers")) {
          db.createObjectStore("vouchers", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("undo_stack")) {
          db.createObjectStore("undo_stack", { keyPath: "id" });
        }
      },
    });
  }
  return _voucherDB;
}

let _lastVoucherId: string | null = null;

export interface BookEntry { ledger_id: string; debit_paise: number; credit_paise: number }

/**
 * Posts through the same executor the Receipt, Payment and Journal screens use,
 * so the entry lands in the company books (not a private store) and follows the
 * same date, period-lock and numbering rules.
 */
export async function postToBooks(input: {
  companyId: string;
  voucherType: "receipt" | "payment" | "journal";
  date: string;
  partyLedgerId: string | null;
  refNo: string;
  narration: string;
  entries: BookEntry[];
}): Promise<VoucherExecutionResult> {
  const dr = input.entries.reduce((sum, e) => sum + e.debit_paise, 0);
  const cr = input.entries.reduce((sum, e) => sum + e.credit_paise, 0);
  if (dr <= 0 || dr !== cr) return { success: false, error: "Debit and credit totals must match." };
  try {
    const { runEntryVoucherCreate } = await import("@/lib/offline/voucher-executors");
    await runEntryVoucherCreate({
      companyId: input.companyId,
      voucherType: input.voucherType,
      voucherDate: input.date,
      partyLedgerId: input.partyLedgerId,
      refNo: input.refNo,
      narration: input.narration,
      total: dr,
      entries: input.entries.map((e, i) => ({ ...e, narration: null, line_no: i + 1 })),
    });
    invalidateToolCache("balance");
    invalidateLedgerCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function undoLastVoucher(): Promise<boolean> {
  if (!_lastVoucherId) return false;
  try {
    const db = await getVoucherDB();
    const record = await db.get("undo_stack", _lastVoucherId);
    if (!record) return false;
    await db.delete("vouchers", _lastVoucherId);
    await db.delete("undo_stack", _lastVoucherId);
    _lastVoucherId = null;

    invalidateToolCache("balance");
    invalidateLedgerCache();

    return true;
  } catch {
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN EXECUTION: VoucherAction → Saved Voucher
// ═════════════════════════════════════════════════════════════════════════════

export async function executeVoucherAction(
  action: VoucherAction,
  companyId: string,
): Promise<VoucherExecutionResult> {
  const draft = action.draft;
  if (action.kind === "reverse") {
    return { success: false, error: "Reversals are not posted from chat yet. Please use the voucher screen." };
  }
  if (draft.intent !== "receipt" && draft.intent !== "payment") {
    return { success: false, error: "Sales and purchase entries need item lines. Please enter them on the Sales or Purchase screen." };
  }
  const intent = draft.intent;
  const bank = draft.cashBankLedgerId;
  const party = draft.partyLedgerId;
  if (!bank || !party) {
    return { success: false, error: "Ledger not selected. Please repeat the entry with the exact ledger names." };
  }
  const ledgers = await getCachedLedgers(companyId);
  if (!ledgers.some((l) => l.id === bank) || !ledgers.some((l) => l.id === party)) {
    return { success: false, error: "Ledger not found in this company." };
  }
  const amt = draft.amountPaise;
  const isReceipt = intent === "receipt";
  // Receipt: Dr Bank, Cr Party. Payment: Cr Bank, Dr Party (same as the screens).
  const entries: BookEntry[] = [
    { ledger_id: bank, debit_paise: isReceipt ? amt : 0, credit_paise: isReceipt ? 0 : amt },
    { ledger_id: party, debit_paise: isReceipt ? 0 : amt, credit_paise: isReceipt ? amt : 0 },
  ];
  return postToBooks({
    companyId,
    voucherType: intent,
    date: draft.date,
    partyLedgerId: party,
    refNo: draft.refNo ?? "",
    narration: draft.narration || `${intent} entry`,
    entries,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHORTCUT: One-shot text → saved voucher (for high-confidence commands)
// ═════════════════════════════════════════════════════════════════════════════

export async function quickCreateVoucher(
  text: string,
  companyId: string,
  today = new Date(),
): Promise<VoucherExecutionResult> {
  const action = await detectVoucherAction(text, companyId, today);
  if (!action) {
    return { success: false, error: "Could not understand the voucher command" };
  }
  if (action.confidence < HIGH_CONFIDENCE) {
    return {
      success: false,
      error: "Command was ambiguous. Please confirm details.",
      confirmationRequired: true,
      confirmationMessage: `Create ${action.draft.intent} voucher for ₹${action.draft.amount} to ${action.draft.displayDetails.partyName}?`,
    };
  }
  return executeVoucherAction(action, companyId);
}

// ═════════════════════════════════════════════════════════════════════════════
//  JOURNAL ENTRY BUILDER (for complex multi-ledger entries)
// ═════════════════════════════════════════════════════════════════════════════

export interface JournalLine {
  ledgerName: string;
  amountPaise: number;
  isDebit: boolean;
}

export async function createJournalVoucher(
  lines: JournalLine[],
  narration: string,
  date: string,
  companyId: string,
): Promise<VoucherExecutionResult> {
  const ledgers = await getCachedLedgers(companyId);
  const entries: VoucherEntry[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    const ledger = pickBest(ledgers, line.ledgerName, undefined, 0.6);
    if (!ledger) {
      return { success: false, error: `Ledger not found: ${line.ledgerName}` };
    }
    entries.push({
      ledger_id: ledger.id,
      ledger_name: ledger.name,
      debit_paise: line.isDebit ? line.amountPaise : 0,
      credit_paise: line.isDebit ? 0 : line.amountPaise,
    });
    if (line.isDebit) totalDebit += line.amountPaise;
    else totalCredit += line.amountPaise;
  }

  const validation = validateDoubleEntry(entries);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  return postToBooks({
    companyId,
    voucherType: "journal",
    date,
    partyLedgerId: null,
    refNo: "",
    narration,
    entries: entries.map((e) => ({ ledger_id: e.ledger_id, debit_paise: e.debit_paise, credit_paise: e.credit_paise })),
  });
}
