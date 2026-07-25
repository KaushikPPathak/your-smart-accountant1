// Phase 2 — Draft-first write actions.
//
// Fully-local natural-language → voucher draft parser. Sits in front of the
// LLM-based draft path so unambiguous commands like
//
//   "receive 50000 from Madhuben in SBI on 15/03"
//   "pay 12000 rent to landlord cash today"
//   "reverse voucher #142"
//   "duplicate yesterday's sales invoice for today"
//
// resolve to a fully-populated preview card without any network round-trip.
// The user just presses Enter to commit.

import { readLedgers, readVouchers } from "@/lib/offline/cache-read";
import { scoreNameMatch } from "./phonetic";
import type { VoucherIntent } from "@/lib/voucher-intent";
import { detectVoucherIntent } from "@/lib/voucher-intent";

export interface LocalVoucherDraft {
  intent: VoucherIntent;
  date: string; // YYYY-MM-DD
  amount: number; // rupees
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

export type VoucherAction =
  | { kind: "new"; draft: LocalVoucherDraft; confidence: number }
  | {
      kind: "reverse";
      draft: LocalVoucherDraft;
      confidence: number;
      source: { number: string; date: string; type: string };
    }
  | {
      kind: "duplicate";
      draft: LocalVoucherDraft;
      confidence: number;
      source: { number?: string; date: string; type: string };
    };

// ---------- Date parsing ---------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

/** Extracts a date from free text. Returns null if none found. */
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
  // 15/03/2026, 15-03-26, 15.03.2026
  let m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = +m[3]; if (yy < 100) yy += 2000;
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }
  // 15/03 or 15-03 (assume current FY / year)
  m = t.match(/\b(?:on\s+)?(\d{1,2})[\/\-.](\d{1,2})\b(?!\s*[:.])/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    const yy = today.getFullYear();
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }
  // 15 Mar 2026 / 15th March
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{2,4}))?\b/);
  if (m && MONTHS[m[2]]) {
    const dd = +m[1], mm = MONTHS[m[2]];
    let yy = m[3] ? +m[3] : today.getFullYear();
    if (yy < 100) yy += 2000;
    return { date: `${yy}-${pad(mm)}-${pad(dd)}`, matchedText: m[0] };
  }
  return null;
}

// ---------- Amount ---------------------------------------------------------

export function parseAmount(text: string): number | null {
  // Strip common currency markers, keep digits and decimals.
  const cleaned = text.replace(/[₹,]/g, " ");
  // Look for "rs 50000" / "50000" / "50,000.50" / "50k" / "1.5 lakh" / "2 cr"
  const lakh = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(lakh|lac)s?\b/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  const cr = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(cr|crore)s?\b/i);
  if (cr) return Math.round(parseFloat(cr[1]) * 10000000);
  const k = cleaned.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  // Plain number — pick the largest to avoid "#142" competing with "50000".
  const nums = Array.from(cleaned.matchAll(/\b(\d{2,}(?:\.\d+)?)\b/g)).map((x) => parseFloat(x[1]));
  if (!nums.length) return null;
  return Math.max(...nums);
}

// ---------- Ledger resolution ---------------------------------------------

interface CachedLedger { id: string; name: string; type: string }

function pickBest(
  ledgers: CachedLedger[],
  phrase: string,
  typeFilter?: (t: string) => boolean,
  threshold = 0.7,
): CachedLedger | null {
  const pool = typeFilter ? ledgers.filter((l) => typeFilter(l.type)) : ledgers;
  let best: { l: CachedLedger; score: number } | null = null;
  for (const l of pool) {
    const s = scoreNameMatch(l.name, phrase).score;
    if (s >= threshold && (!best || s > best.score)) best = { l, score: s };
  }
  return best?.l ?? null;
}

const CASH_RE = /\b(cash)\b/i;
// After a preposition (in|to|via|from|through) followed by 1–3 words that look
// like a bank/account name. We stop at obvious sentence tokens.
const BANK_RE = /\b(?:in|via|through|to|from|into)\s+([A-Za-z][A-Za-z0-9 &.\-]{1,40}?)\b(?=\s*(?:on|dated|today|yesterday|tomorrow|for|against|by|,|\.|$))/i;

// Words that indicate the phrase is *not* a party/account name.
const STOP = new Set([
  "the","a","an","of","for","to","from","in","on","by","via","through","into",
  "cash","bank","today","yesterday","tomorrow","account","acct","paid","paying",
  "pay","received","receive","sold","bought","reverse","duplicate","invoice",
  "voucher","and","with","against","dated",
]);

function cleanPhrase(s: string): string {
  return s.replace(/[^A-Za-z0-9 &.\-]/g, " ").trim().replace(/\s+/g, " ");
}

/** Extract candidate party phrase after "to|from|on|for" preposition. */
function extractPartyPhrase(text: string, intent: VoucherIntent): string | null {
  // Direction preposition: receipts → "from", payments/sales → "to".
  const primary = intent === "receipt" || intent === "purchase" ? /\bfrom\s+/i : /\bto\s+/i;
  const fallback = /\b(?:to|from|for)\s+/i;
  for (const re of [primary, fallback]) {
    const idx = text.search(re);
    if (idx < 0) continue;
    const after = text.slice(idx).replace(re, "");
    // Take up to the next preposition/marker.
    const cut = after.split(/\b(?:in|via|through|on|dated|today|yesterday|tomorrow|for|against|by|cash|,)\b/i)[0];
    const words = cleanPhrase(cut).split(" ").filter((w) => w && !STOP.has(w.toLowerCase()));
    if (words.length) return words.slice(0, 5).join(" ");
  }
  return null;
}

function extractBankPhrase(text: string): string | null {
  const m = text.match(BANK_RE);
  if (!m) return null;
  const words = cleanPhrase(m[1]).split(" ").filter((w) => w && !STOP.has(w.toLowerCase()));
  return words.length ? words.join(" ") : null;
}

// ---------- Reverse / Duplicate detection ---------------------------------

const REVERSE_RE = /\breverse\s+(?:voucher\s+)?#?\s*([A-Za-z0-9\-\/]+)/i;
const DUPLICATE_RE = /\b(?:duplicate|copy|repeat|clone)\b/i;

async function findVoucherByNumber(companyId: string, number: string) {
  const all = (await readVouchers(companyId)) as any[];
  const needle = number.replace(/^#/, "").toLowerCase();
  return all.find((v) => String(v.voucher_number ?? "").toLowerCase() === needle) ?? null;
}

function oppositeIntent(intent: VoucherIntent): VoucherIntent {
  switch (intent) {
    case "payment": return "receipt";
    case "receipt": return "payment";
    // Sales / purchase reversals are a fresh entry of the same type marked as
    // a reversal; the accountant confirms Dr/Cr in the form.
    default: return intent;
  }
}

// ---------- Main entry point ----------------------------------------------

export async function detectVoucherAction(
  text: string,
  companyId: string,
  today = new Date(),
): Promise<VoucherAction | null> {
  const raw = text.trim();
  if (!raw) return null;

  // --- Reverse ------------------------------------------------------------
  const revMatch = raw.match(REVERSE_RE);
  if (revMatch) {
    const v = await findVoucherByNumber(companyId, revMatch[1]);
    if (!v) {
      return null; // let LLM path or "not found" reply take over
    }
    const srcIntent = (String(v.voucher_type) as VoucherIntent) ?? "payment";
    const revIntent = oppositeIntent(srcIntent);
    const amt = Number(v.total_amount_paise ?? 0) / 100;
    const ledgers = (await readLedgers(companyId)) as CachedLedger[];
    const party = v.party_ledger_id ? ledgers.find((l) => l.id === v.party_ledger_id) : null;
    return {
      kind: "reverse",
      confidence: 0.95,
      source: { number: v.voucher_number, date: v.voucher_date, type: v.voucher_type },
      draft: {
        intent: revIntent,
        date: iso(today),
        amount: amt,
        narration: `Reversal of ${srcIntent} voucher #${v.voucher_number} dated ${v.voucher_date}${v.narration ? ` — ${v.narration}` : ""}`,
        refNo: `REV-${v.voucher_number}`,
        partyLedgerId: party?.id,
        displayDetails: { partyName: party?.name },
      },
    };
  }

  // --- Duplicate ----------------------------------------------------------
  if (DUPLICATE_RE.test(raw)) {
    // Which type & which day are we duplicating?
    const intent = detectVoucherIntent(raw) ?? inferIntentFromText(raw);
    if (!intent) return null;
    // Explicit source number: "duplicate voucher #142 for today"
    const numMatch = raw.match(/#\s*([A-Za-z0-9\-\/]+)/);
    const targetDate = parseDate(raw, today)?.date ?? iso(today);
    let source: any = null;
    if (numMatch) {
      source = await findVoucherByNumber(companyId, numMatch[1]);
    } else {
      // "duplicate yesterday's sales invoice for today"
      const sourceDayMatch = raw.match(/\b(yesterday|today|last\s+week)\b/i);
      let sourceDate = iso(today);
      if (sourceDayMatch) {
        const d = new Date(today);
        if (/yesterday/i.test(sourceDayMatch[1])) d.setDate(d.getDate() - 1);
        else if (/last\s+week/i.test(sourceDayMatch[1])) d.setDate(d.getDate() - 7);
        sourceDate = iso(d);
      }
      const all = (await readVouchers(companyId, { voucher_type: intent, from: sourceDate, to: sourceDate })) as any[];
      source = all[0] ?? null;
    }
    if (!source) return null;
    const amt = Number(source.total_amount_paise ?? 0) / 100;
    const ledgers = (await readLedgers(companyId)) as CachedLedger[];
    const party = source.party_ledger_id ? ledgers.find((l) => l.id === source.party_ledger_id) : null;
    return {
      kind: "duplicate",
      confidence: 0.9,
      source: { number: source.voucher_number, date: source.voucher_date, type: source.voucher_type },
      draft: {
        intent,
        date: targetDate,
        amount: amt,
        narration: source.narration ? `${source.narration} (copy of #${source.voucher_number})` : `Copy of #${source.voucher_number}`,
        partyLedgerId: party?.id,
        displayDetails: { partyName: party?.name },
      },
    };
  }

  // --- New voucher (fully local) -----------------------------------------
  const intent = detectVoucherIntent(raw);
  if (!intent) return null;

  const amount = parseAmount(raw);
  if (!amount) return null;

  const dateRes = parseDate(raw, today);
  const date = dateRes?.date ?? iso(today);

  const ledgers = (await readLedgers(companyId)) as CachedLedger[];

  // Cash or bank?
  const usesCash = CASH_RE.test(raw);
  const bankPhrase = usesCash ? null : extractBankPhrase(raw);
  const cashBank = usesCash
    ? pickBest(ledgers, "cash", (t) => t === "cash", 0.9)
    : bankPhrase
      ? pickBest(ledgers, bankPhrase, (t) => t === "bank" || t === "cash")
      : null;

  // Party.
  const partyPhrase = extractPartyPhrase(raw, intent);
  let party: CachedLedger | null = null;
  if (partyPhrase) {
    const partyTypes = intent === "receipt" || intent === "sales"
      ? (t: string) => t === "sundry_debtor" || t === "income_direct" || t === "income_indirect"
      : (t: string) => t === "sundry_creditor" || t === "expense_direct" || t === "expense_indirect";
    party = pickBest(ledgers, partyPhrase, partyTypes)
      // Fallback: any name match at all (creditors/debtors created after cache warmup).
      ?? pickBest(ledgers, partyPhrase);
  }

  // Confidence: strongest when we have amount + party + account.
  const confidence =
    0.4 +
    (party ? 0.3 : 0) +
    (cashBank ? 0.2 : 0) +
    (dateRes ? 0.1 : 0);

  return {
    kind: "new",
    confidence,
    draft: {
      intent,
      date,
      amount,
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

function inferIntentFromText(t: string): VoucherIntent | null {
  if (/\bsales?\s+invoice\b/i.test(t)) return "sales";
  if (/\bpurchase\s+invoice\b/i.test(t)) return "purchase";
  if (/\breceipt\b/i.test(t)) return "receipt";
  if (/\bpayment\b/i.test(t)) return "payment";
  return null;
}
