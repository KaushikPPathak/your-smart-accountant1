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
  { rx: /^(profit\s+for\s+the\s+period)\b/i, side: "Cr" },
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
  { rx: /^(profit\s*\/\s*loss\s+adjusted)\b/i, side: "Dr" },
  { rx: /^(misc(ellaneous)?\s+expenses?|profit\s*&?\s*loss\s+a\/c|loss\s+to\s+be\s+adjusted)\b/i, side: "Dr" },
  { rx: /^application(s)?\s+of\s+funds\b/i, side: "Dr" },
];

// Lines we ALWAYS skip — pure document chrome, never an account name.
// Note: we deliberately do NOT skip lines starting with "Total" / "Opening" /
// "Closing" because real ledger names contain those words (e.g. "Opening Stock",
// "Total Salary"). We only skip them later if they have no useful amount or
// look like a grand-total summary line.
const SKIP_LINE_RX =
  /^(particulars|trial\s+balance|balance\s+sheet|profit\s*&?\s*loss|company|gstin|address|date\s*[:\-]|page\s+\d|continued|note(s)?\s*[:\-]|schedule\s*[:\-]|amount\s*\(?rs|in\s+rupees|figures\s+in)/i;

// Hard skip: standalone summary/total rows (no account name).
const TOTAL_LINE_RX = /^(grand\s+total|sub.?total|total)\s*[:\-]?\s*[\d.,\-]*\s*(dr|cr)?\.?\s*$/i;
const AMOUNT_TOKEN_PATTERN = "-?\\d{1,3}(?:,\\d{2,3})*(?:\\.\\d{1,2})?|-?\\d+(?:\\.\\d{1,2})?";
const AMOUNT_TOKEN_RX = new RegExp(AMOUNT_TOKEN_PATTERN, "g");
const FIRST_AMOUNT_TOKEN_RX = new RegExp(AMOUNT_TOKEN_PATTERN);
const OPENING_AMOUNT_TOKEN_RX = /-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})/g;

function normaliseOpeningText(text: string): string {
  return text
    // Some OCR engines insert spaces between every letter for stylised headings
    // like "B A L A N C E   S H E E T". Collapse those before parsing.
    .replace(/\b((?:[A-Z]\s){2,}[A-Z])\b/g, (m) => m.replace(/\s+/g, ""))
    .replace(/\bSOURCESOFFUNDS\b/gi, "Sources of Funds")
    .replace(/\bAPPLICATIONSOFFUNDS\b/gi, "Applications of Funds")
    .replace(/\bAPPLICATIONOFFUNDS\b/gi, "Application of Funds")
    .replace(/\bBALANCESHEET\b/gi, "Balance Sheet")
    .replace(/\bTRIALBALANCE\b/gi, "Trial Balance");
}

function stripOpeningContext(label: string, fallbackSide: "Dr" | "Cr") {
  let name = label
    .replace(/---\s*page\s*break\s*---/gi, " ")
    .replace(/[|:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let side = fallbackSide;

  let changed = true;
  while (changed && name) {
    changed = false;

    const mainHeading = name.match(/^(sources?\s+of\s+funds|application(s)?\s+of\s+funds|balance\s+sheet|trial\s+balance)\b/i);
    if (mainHeading) {
      if (/^sources?/i.test(mainHeading[0])) side = "Cr";
      if (/^application/i.test(mainHeading[0])) side = "Dr";
      name = name.slice(mainHeading[0].length).trim();
      changed = true;
      continue;
    }

    for (const heading of GROUP_HEADINGS) {
      const match = name.match(heading.rx);
      if (match) {
        side = heading.side;
        name = name.slice(match[0].length).trim();
        changed = true;
        break;
      }
    }
  }

  name = name.replace(/^[.\-–—]+|[.\-–—]+$/g, "").trim();
  return { name, side };
}

function dedupeOpenings(rows: ExtractedOpening[]): ExtractedOpening[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.account_name.toLowerCase()}|${row.amount.toFixed(2)}|${row.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseRunOnOpeningBalanceText(text: string): ExtractedOpening[] {
  const sectionMatch = text.match(
    /\b(sources?\s+of\s+funds|application(s)?\s+of\s+funds|capital(\s+account)?|current\s+liabilit(y|ies)|fixed\s+assets?|current\s+assets?)\b/i,
  );
  const focused = sectionMatch?.index && sectionMatch.index > 0 ? text.slice(sectionMatch.index) : text;
  OPENING_AMOUNT_TOKEN_RX.lastIndex = 0;
  const matches = [...focused.matchAll(OPENING_AMOUNT_TOKEN_RX)];
  const out: ExtractedOpening[] = [];
  let currentSide: "Dr" | "Cr" = "Dr";
  let previousEnd = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const prefix = focused.slice(previousEnd, index).replace(/\s+/g, " ").trim();
    previousEnd = index + match[0].length;

    const stripped = stripOpeningContext(prefix, currentSide);
    currentSide = stripped.side;
    let name = stripped.name.replace(/\s+(dr|cr|debit|credit)\.?$/i, "").trim();

    if (!name || name.length < 2) continue;
    if (/^(grand\s+total|sub.?total|total)$/i.test(name)) continue;
    if (GROUP_HEADINGS.some((heading) => heading.rx.test(name))) continue;

    const value = num(match[0]);
    if (!value || Math.abs(value) < 0.01) continue;

    let side = stripped.side;
    if (value < 0) side = side === "Dr" ? "Cr" : "Dr";
    out.push({ account_name: name, amount: Math.abs(value), side });
  }

  return dedupeOpenings(out);
}

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
  const normalised = normaliseOpeningText(text);

  // When PDF/image OCR returns the balance sheet as one long paragraph instead
  // of rows, line-based parsing merges many accounts into one. In that case,
  // parse every "label amount" segment from the paragraph directly.
  const physicalLines = normalised.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (physicalLines.length <= 2) {
    const paragraphRows = parseRunOnOpeningBalanceText(normalised);
    if (paragraphRows.length > 1) return paragraphRows;
  }

  const lines = normalised
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2);

  const out: ExtractedOpening[] = [];
  let currentSide: "Dr" | "Cr" = "Dr"; // updated as we walk through sections

  for (const raw of lines) {
    if (SKIP_LINE_RX.test(raw)) continue;
    if (TOTAL_LINE_RX.test(raw)) continue;

    // Section heading: sets the side for following detail rows. Heading lines
    // typically have NO numbers, or only a single group-total number.
    const headingHit = GROUP_HEADINGS.find((h) => h.rx.test(raw));
    const numericTokens = raw.match(AMOUNT_TOKEN_RX) || [];

    if (headingHit) {
      currentSide = headingHit.side;
      // Pure heading (no numbers) → skip. Otherwise this is a condensed
      // balance-sheet line that doubles as both heading AND data row
      // (e.g. "Bank Accounts 530.58") — fall through and emit it.
      if (numericTokens.length === 0) continue;
    }

    if (numericTokens.length === 0) continue;

    // Account name = everything before the first numeric token
    const firstNumIdx = raw.search(FIRST_AMOUNT_TOKEN_RX);
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

    // Strip trailing Dr/Cr marker from name if present
    name = name.replace(/\s+(dr|cr|debit|credit)\.?$/i, "").trim();
    if (name.length < 2) continue;

    out.push({ account_name: name, amount, side });
  }

  if (out.length <= 1 || /sources?\s+of\s+funds|application(s)?\s+of\s+funds/i.test(normalised)) {
    const paragraphRows = parseRunOnOpeningBalanceText(normalised);
    if (paragraphRows.length > out.length) return paragraphRows;
  }

  return dedupeOpenings(out);
}
