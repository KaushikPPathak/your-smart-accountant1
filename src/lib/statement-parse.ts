// Heuristic parsers for OCR text → structured rows.
// Designed for Indian bank statements and trial balances. No AI calls.

// ============================================================================
// Bank statement
// ============================================================================
export interface ExtractedTxn {
  txn_date: string; // YYYY-MM-DD
  description: string;
  reference: string;
  debit: number; // rupees
  credit: number; // rupees
  balance: number | null;
}

const DATE_RX =
  /\b(\d{1,2})[\/\-.\s](\d{1,2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\/\-.\s](\d{2,4})\b/i;
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isoFromMatch(m: RegExpMatchArray): string | null {
  const d = m[1].padStart(2, "0");
  let mo = m[2].toLowerCase();
  if (MONTHS[mo.slice(0, 3)]) mo = MONTHS[mo.slice(0, 3)];
  else mo = mo.padStart(2, "0");
  let y = m[3];
  if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
  if (parseInt(mo) > 12 || parseInt(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

function num(s: string): number {
  const n = Number(s.replace(/[, ]/g, "").replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

// Extract Shipping Bill / Invoice references for "Merchant Export" linking.
export function extractTradeRefs(text: string): { shipping_bills: string[]; invoices: string[] } {
  const sb = new Set<string>();
  const inv = new Set<string>();
  for (const m of text.matchAll(/\bSB[#:\s-]*(\d{6,10})\b/gi)) sb.add(m[1]);
  for (const m of text.matchAll(/\bShipping\s*Bill[#:\s-]*(\d{6,10})\b/gi)) sb.add(m[1]);
  for (const m of text.matchAll(/\b(?:INV|Invoice)[#:\s-]*([A-Z0-9\/\-]{4,20})\b/gi))
    inv.add(m[1]);
  return { shipping_bills: [...sb], invoices: [...inv] };
}

/**
 * Best-effort line parser. Each line that begins with a date is treated as a txn.
 * Trailing numeric tokens on the line are interpreted as amount(s) + balance.
 * - 1 trailing number → amount on a debit/credit guess from cue words
 * - 2 trailing numbers → amount + balance
 * - 3 trailing numbers → debit, credit, balance (one of dr/cr is 0)
 */
export function parseStatementText(text: string): ExtractedTxn[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 8);

  const out: ExtractedTxn[] = [];
  for (const raw of lines) {
    const dm = raw.match(DATE_RX);
    if (!dm || (dm.index ?? 99) > 12) continue;
    const iso = isoFromMatch(dm);
    if (!iso) continue;

    const after = raw.slice((dm.index ?? 0) + dm[0].length).trim();
    // Pull trailing numeric tokens (allow comma + decimal)
    const tokens = after.match(/[-]?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})|[-]?\d+(?:\.\d{1,2})?/g) || [];
    if (tokens.length === 0) continue;
    const tail = tokens.slice(-3).map(num);

    let debit = 0, credit = 0, balance: number | null = null;
    const cue = after.toLowerCase();
    const isDr = /\b(dr|debit|withdraw|paid|nft|atm|pos)\b/.test(cue);
    const isCr = /\b(cr|credit|deposit|received|imps in|neft cr)\b/.test(cue);

    if (tail.length >= 3) {
      debit = tail[0]; credit = tail[1]; balance = tail[2];
      // If both dr+cr nonzero, decide by cue
      if (debit && credit) {
        if (isCr && !isDr) { credit = debit + credit; debit = 0; }
        else { debit = debit + credit; credit = 0; }
      }
    } else if (tail.length === 2) {
      balance = tail[1];
      if (isCr && !isDr) credit = tail[0];
      else debit = tail[0];
    } else {
      if (isCr && !isDr) credit = tail[0];
      else debit = tail[0];
    }

    // Strip the trailing numbers from the description
    let desc = after;
    for (const t of tokens.slice(-3)) {
      desc = desc.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$"), "").trim();
    }
    desc = desc.replace(/[\s|.\-]+$/g, "").trim();

    // Reference: longest alnum token of length ≥ 6
    const refTok = (desc.match(/\b[A-Z0-9]{6,}\b/) || [""])[0];

    out.push({
      txn_date: iso,
      description: desc.slice(0, 200) || raw.slice(0, 200),
      reference: refTok,
      debit,
      credit,
      balance,
    });
  }
  return out;
}

// ============================================================================
// Trial Balance / Opening Balance parser
// ============================================================================
export interface ExtractedOpening {
  account_name: string;
  amount: number; // rupees
  side: "Dr" | "Cr";
}

// Group headings commonly found in Tally / standard Indian balance sheets.
// Used to (a) skip the heading line itself and (b) infer Dr/Cr side for the
// detail rows that follow it.
const GROUP_HEADINGS: { rx: RegExp; side: "Dr" | "Cr" }[] = [
  // Liabilities / Equity → Cr
  { rx: /^(capital(\s+account)?|reserves?(\s+&?\s*surplus)?|owners?\s+equity)\b/i, side: "Cr" },
  { rx: /^(current\s+liabilit(y|ies)|liabilit(y|ies))\b/i, side: "Cr" },
  { rx: /^(sundry\s+creditors?|creditors?|accounts?\s+payable|trade\s+payables?)\b/i, side: "Cr" },
  { rx: /^(duties\s*(ies)?\s*&?\s*taxes|gst\s+payable)\b/i, side: "Cr" },
  { rx: /^(loans?\s*\(?liabilit(y|ies)?\)?|secured\s+loans?|unsecured\s+loans?|borrowings?)\b/i, side: "Cr" },
  { rx: /^(provisions?|outstanding\s+expenses?|expenses?\s+payable)\b/i, side: "Cr" },
  { rx: /^source(s)?\s+of\s+funds\b/i, side: "Cr" },
  // Assets → Dr
  { rx: /^(fixed\s+assets?)\b/i, side: "Dr" },
  { rx: /^(current\s+assets?)\b/i, side: "Dr" },
  { rx: /^(investments?)\b/i, side: "Dr" },
  { rx: /^(bank\s+accounts?|bank\s+ocd?\s+a\/c)\b/i, side: "Dr" },
  { rx: /^(cash[\s-]*in[\s-]*hand|cash\s+account)\b/i, side: "Dr" },
  { rx: /^(sundry\s+debtors?|debtors?|accounts?\s+receivable|trade\s+receivables?)\b/i, side: "Dr" },
  { rx: /^(loans?\s*&?\s*advances?(\s*\(?asset\)?)?)\b/i, side: "Dr" },
  { rx: /^(stock[\s-]*in[\s-]*hand|inventory|closing\s+stock|opening\s+stock)\b/i, side: "Dr" },
  { rx: /^(misc(ellaneous)?\s+expenses?|profit\s*&?\s*loss\s+a\/c|loss\s+to\s+be\s+adjusted)\b/i, side: "Dr" },
  { rx: /^application(s)?\s+of\s+funds\b/i, side: "Dr" },
];

const SKIP_LINE_RX =
  /^(particulars|trial\s+balance|balance\s+sheet|profit\s*&?\s*loss|grand\s+total|sub.?total|total\b|opening\s+balance|closing\s+balance|company|gstin|address|date|page|continued|note|notes|schedule|amount\s*\(?rs)/i;

/**
 * Parse OCR text from a trial balance / balance sheet image.
 *
 * Handles two layouts:
 *  1. Trial balance:  "<Account> <Debit> <Credit>"  (one column blank or 0)
 *  2. Tally balance sheet (sectioned):
 *        Capital Account
 *          Kaushik P Pathak       2,51,497.53     2,51,497.53
 *        Current Liabilities
 *          Duties & Taxes          -9,549.46
 *          Sundry Creditors       -25,401.00
 *                                                 -31,950.46
 *     Sub-total / group-total numbers (no leading account name) are skipped.
 *     Negative amounts flip the side inherited from the surrounding heading.
 */
export function parseTrialBalanceText(text: string): ExtractedOpening[] {
  // Some OCR engines insert spaces between every letter for stylised headings
  // like "B A L A N C E   S H E E T". Collapse those before parsing.
  const normalised = text.replace(/\b((?:[A-Z]\s){2,}[A-Z])\b/g, (m) => m.replace(/\s+/g, ""));

  const lines = normalised
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2);

  const out: ExtractedOpening[] = [];
  let currentSide: "Dr" | "Cr" = "Dr"; // updated as we walk through sections

  for (const raw of lines) {
    if (SKIP_LINE_RX.test(raw)) continue;

    // Section heading: sets the side for following detail rows. Heading lines
    // typically have NO numbers, or only a single group-total number.
    const headingHit = GROUP_HEADINGS.find((h) => h.rx.test(raw));
    const numericTokens = raw.match(/-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?/g) || [];

    if (headingHit) {
      currentSide = headingHit.side;
      // Pure heading (no numbers) → skip. Otherwise this is a condensed
      // balance-sheet line that doubles as both heading AND data row
      // (e.g. "Bank Accounts 530.58") — fall through and emit it.
      if (numericTokens.length === 0) continue;
    }

    if (numericTokens.length === 0) continue;

    // Account name = everything before the first numeric token
    const firstNumIdx = raw.search(/-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?/);
    let name = (firstNumIdx > 0 ? raw.slice(0, firstNumIdx) : "").trim();
    name = name.replace(/[:\-|.]+$/g, "").trim();

    // Lines that start with numbers (no name) are sub-totals — skip.
    if (name.length < 2) continue;

    const tail = numericTokens.slice(-3).map(num);
    const sideMatch = raw.match(/\b(Dr|Cr|Debit|Credit)\b\.?\s*$/i);
    let explicitSide: "Dr" | "Cr" | null = null;
    if (sideMatch) explicitSide = /^d/i.test(sideMatch[1]) ? "Dr" : "Cr";

    let amount = 0;
    let side: "Dr" | "Cr" = explicitSide ?? currentSide;

    if (tail.length >= 2 && tail[0] && tail[1] && Math.abs(Math.abs(tail[0]) - Math.abs(tail[1])) < 0.5) {
      // Tally pattern: "<amount> <same amount as group sub-total>" → take first
      amount = Math.abs(tail[0]);
      if (tail[0] < 0) side = side === "Dr" ? "Cr" : "Dr";
    } else if (tail.length === 2 && tail[0] && !tail[1]) {
      amount = Math.abs(tail[0]); if (tail[0] < 0) side = side === "Dr" ? "Cr" : "Dr";
      if (!explicitSide) side = "Dr";
    } else if (tail.length === 2 && !tail[0] && tail[1]) {
      amount = Math.abs(tail[1]); if (tail[1] < 0) side = side === "Dr" ? "Cr" : "Dr";
      if (!explicitSide) side = "Cr";
    } else {
      const first = tail[0];
      amount = Math.abs(first);
      if (first < 0) side = side === "Dr" ? "Cr" : "Dr";
    }

    if (!amount || amount < 0.01) continue;

    out.push({ account_name: name, amount, side });
  }

  return out;
}
