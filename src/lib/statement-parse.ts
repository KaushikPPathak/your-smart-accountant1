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
  if (!m[1] || !m[2] || !m[3]) return null;
  if (!/^\d{1,2}$/.test(m[1])) return null;
  const d = m[1].padStart(2, "0");
  let mo = m[2].toLowerCase();
  if (MONTHS[mo.slice(0, 3)]) mo = MONTHS[mo.slice(0, 3)];
  else if (/^\d{1,2}$/.test(mo)) mo = mo.padStart(2, "0");
  else return null;
  let y = m[3];
  if (!/^\d{2,4}$/.test(y)) return null;
  if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
  if (y.length !== 4) return null;
  const dN = parseInt(d, 10);
  const moN = parseInt(mo, 10);
  const yN = parseInt(y, 10);
  if (!dN || !moN || moN > 12 || dN > 31) return null;
  if (yN < 1900 || yN > 2999) return null;
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
  /** Group code inferred from the surrounding section heading (e.g. "CAPITAL_ACCOUNT").
   *  Empty string when no heading was active. Used to seed the editable group on import. */
  section_hint?: string;
}

export interface OpeningBalanceTotals {
  sourcesTotal: number | null;
  applicationsTotal: number | null;
}

// Group headings commonly found in Tally / standard Indian balance sheets.
// Used to (a) skip the heading line itself and (b) infer Dr/Cr side for the
// detail rows that follow it.
const GROUP_HEADINGS: { rx: RegExp; side: "Dr" | "Cr"; group?: string }[] = [
  // Liabilities / Equity → Cr
  { rx: /^(profit\s+for\s+the\s+period)\b/i, side: "Cr", group: "RESERVES_AND_SURPLUS" },
  { rx: /^(capital(\s+account)?|owners?\s+equity)\b/i, side: "Cr", group: "CAPITAL_ACCOUNT" },
  { rx: /^(reserves?(\s+&?\s*surplus)?)\b/i, side: "Cr", group: "RESERVES_AND_SURPLUS" },
  { rx: /^(current\s+liabilit(y|ies)|liabilit(y|ies))\b/i, side: "Cr", group: "CURRENT_LIABILITIES" },
  { rx: /^(sundry\s+creditors?|creditors?|accounts?\s+payable|trade\s+payables?)\b/i, side: "Cr", group: "SUNDRY_CREDITORS" },
  { rx: /^(duties\s*&?\s*taxes|duties\s+and\s+taxes|gst\s+payable)\b/i, side: "Cr", group: "DUTIES_AND_TAXES" },
  { rx: /^(secured\s+loans?)\b/i, side: "Cr", group: "SECURED_LOANS" },
  { rx: /^(unsecured\s+loans?|loans?\s*\(?liabilit(y|ies)?\)?|borrowings?|loans?\s*&?\s*advances?\s*\(?liabilit(y|ies)?\)?)\b/i, side: "Cr", group: "UNSECURED_LOANS" },
  // Bank OD / CC limits are LIABILITIES (Secured Loan), NOT bank assets — common Tally mistake
  { rx: /^(bank\s+o\.?\s*d\.?\s*a\/c|bank\s+overdraft|cash\s+credit\s+a\/c|cc\s+a\/c|o\/?d\s+a\/c)\b/i, side: "Cr", group: "SECURED_LOANS" },
  { rx: /^(provisions?|outstanding\s+expenses?|expenses?\s+payable)\b/i, side: "Cr", group: "PROVISIONS" },
  { rx: /^(suspense(\s+a\/c)?)\b/i, side: "Cr", group: "CURRENT_LIABILITIES" },
  { rx: /^source(s)?\s+of\s+funds\b/i, side: "Cr" },
  // Assets → Dr
  { rx: /^(fixed\s+assets?)\b/i, side: "Dr", group: "FIXED_ASSETS" },
  { rx: /^(investments?)\b/i, side: "Dr", group: "INVESTMENTS" },
  { rx: /^(bank\s+accounts?|bank\s+ocd?\s+a\/c)\b/i, side: "Dr", group: "BANK_ACCOUNTS" },
  { rx: /^(cash[\s-]*in[\s-]*hand|cash\s+account)\b/i, side: "Dr", group: "CASH_IN_HAND" },
  { rx: /^(cash\s*&?\s*bank(\s+balances?)?)\b/i, side: "Dr", group: "BANK_ACCOUNTS" },
  { rx: /^(sundry\s+debtors?|debtors?|accounts?\s+receivable|trade\s+receivables?)\b/i, side: "Dr", group: "SUNDRY_DEBTORS" },
  { rx: /^(loans?\s*&?\s*advances?(\s*\(?asset\)?)?|advances?\s*\(?asset\)?)\b/i, side: "Dr", group: "LOANS_AND_ADVANCES_ASSET" },
  { rx: /^(deposits?(\s+\(?asset\)?)?|security\s+deposits?)\b/i, side: "Dr", group: "CURRENT_ASSETS" },
  { rx: /^(stock[\s-]*in[\s-]*hand|inventory|closing\s+stock|opening\s+stock)\b/i, side: "Dr", group: "STOCK_IN_HAND" },
  { rx: /^(current\s+assets?)\b/i, side: "Dr", group: "CURRENT_ASSETS" },
  { rx: /^(profit\s*\/\s*loss\s+adjusted)\b/i, side: "Dr", group: "MISC_EXPENSES_ASSET" },
  { rx: /^(misc(ellaneous)?\s+expenses?|profit\s*&?\s*loss\s+a\/c|loss\s+to\s+be\s+adjusted)\b/i, side: "Dr", group: "MISC_EXPENSES_ASSET" },
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
const FULL_AMOUNT_TOKEN_PATTERN = "-?\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|-?\\d+(?:\\.\\d{1,2})?";
const AMOUNT_TOKEN_RX = new RegExp(AMOUNT_TOKEN_PATTERN, "g");
const FIRST_AMOUNT_TOKEN_RX = new RegExp(AMOUNT_TOKEN_PATTERN);
const OPENING_AMOUNT_TOKEN_RX = /-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})/g;
const OPENING_SECTION_RX = /\b(sources?\s+of\s+funds|application(s)?\s+of\s+funds)\b/gi;

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
  let section = "";

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
        if (heading.group) section = heading.group;
        const rest = name.slice(match[0].length).trim();
        if (rest) {
          name = rest;
          changed = true;
        }
        break;
      }
    }
  }

  name = name.replace(/^[.\-–—]+|[.\-–—]+$/g, "").trim();
  return { name, side, section };
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

export function extractOpeningBalanceTotals(text: string): OpeningBalanceTotals {
  const normalised = normaliseOpeningText(text).replace(/\s+/g, " ");
  const sections = [...normalised.matchAll(OPENING_SECTION_RX)];
  const totals: OpeningBalanceTotals = { sourcesTotal: null, applicationsTotal: null };

  for (let i = 0; i < sections.length; i += 1) {
    const start = sections[i].index ?? 0;
    const end = sections[i + 1]?.index ?? normalised.length;
    const chunk = normalised.slice(start, end);
    const totalMatch = [...chunk.matchAll(new RegExp(`\\bTotals?\\s+(${FULL_AMOUNT_TOKEN_PATTERN})`, "gi"))].pop();
    if (!totalMatch) continue;
    if (/source/i.test(sections[i][1])) totals.sourcesTotal = Math.abs(num(totalMatch[1]));
    else totals.applicationsTotal = Math.abs(num(totalMatch[1]));
  }

  return totals;
}

// ============================================================================
// Document shape + as-of date detection
// ============================================================================

export type BalanceSheetShape =
  | "horizontal"      // Two-column "Liabilities | Assets" (Tally / Busy print)
  | "vertical"        // Single column with section headings (Sources / Applications)
  | "t-format"        // Two columns: Dr accounts left, Cr accounts right
  | "trial-balance"   // "Particulars | Debit | Credit" tabular trial balance
  | "unknown";

/**
 * Best-effort layout detector. We look at the linearised OCR/PDF text and
 * decide which of the 4 common Indian-accounting layouts the document is in.
 * The parser then chooses the right strategy. (For PDFs the ocr.ts layer
 * already split horizontal two-column pages into "left then right" — but we
 * still detect the shape here so the UI can show it and so that pure-image
 * OCR scans get the same treatment.)
 */
export function detectBalanceSheetShape(text: string): BalanceSheetShape {
  const t = normaliseOpeningText(text);
  const lower = t.toLowerCase();

  // Trial-balance tabular: explicit Debit + Credit column headers near the top
  if (/\bparticulars\b[\s\S]{0,80}\bdebit\b[\s\S]{0,40}\bcredit\b/i.test(t)) return "trial-balance";
  if (/\bdr\.?\s*amount\b[\s\S]{0,60}\bcr\.?\s*amount\b/i.test(t)) return "trial-balance";

  // T-format trial balance: "Dr." and "Cr." appear as column headers AND a pipe/gap split
  if (/\bdr\.\s*$/im.test(t) && /\bcr\.\s*$/im.test(t)) return "t-format";

  // Horizontal balance sheet: BOTH "Liabilities" and "Assets" present at top
  const hasLiab = /\bliabilit(y|ies)\b/i.test(lower);
  const hasAsst = /\bassets?\b/i.test(lower);
  if (hasLiab && hasAsst) return "horizontal";

  // Vertical (Schedule III / Tally vertical): Sources of Funds + Applications of Funds
  if (/\bsources?\s+of\s+funds\b/i.test(lower) && /\bapplication(s)?\s+of\s+funds\b/i.test(lower))
    return "vertical";
  // Vertical Schedule III variant
  if (/\bequity\s+and\s+liabilit(y|ies)\b/i.test(lower) && /\b(non[- ]current|current)\s+assets?\b/i.test(lower))
    return "vertical";

  return "unknown";
}

export interface AsOfDateInfo {
  /** ISO date parsed from the document, e.g. "2025-03-31" — null if not found. */
  asOfDate: string | null;
  /** The date that opening balances should be posted as (always one day after asOfDate). */
  openingDate: string;
  /** True when asOfDate is 31-Mar (Indian FY end) → opening = 1-Apr next FY. */
  isFinancialYearEnd: boolean;
  /** Human-friendly source phrase from the document (for the UI). */
  matchedPhrase: string | null;
}

const AS_OF_RXES: RegExp[] = [
  // "as at 31-03-2025", "as on 31/03/2025", "as of 31.03.2025"
  /\bas\s+(?:at|on|of)\s+(\d{1,2}[./\-\s](?:\d{1,2}|[A-Za-z]{3,9})[./\-\s]\d{2,4})\b/i,
  // "at the end of 31-03-2025"
  /\bat\s+the\s+end\s+of\s+(\d{1,2}[./\-\s](?:\d{1,2}|[A-Za-z]{3,9})[./\-\s]\d{2,4})\b/i,
  // "for the (year|period) ended 31-03-2025"
  /\b(?:year|period|quarter|month)\s+end(?:ed|ing)\s+(\d{1,2}[./\-\s](?:\d{1,2}|[A-Za-z]{3,9})[./\-\s]\d{2,4})\b/i,
  // "Date: 31/03/2025"
  /\bdate\s*[:\-]\s*(\d{1,2}[./\-\s](?:\d{1,2}|[A-Za-z]{3,9})[./\-\s]\d{2,4})\b/i,
  // Bare ( ... 31-03-2025 ... )
  /\(\s*[^()]*?(\d{1,2}[./\-\s](?:\d{1,2}|[A-Za-z]{3,9})[./\-\s]\d{2,4})[^()]*?\)/i,
  // "31st March 2025"
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})[\s,]+(\d{2,4})\b/i,
];

function parseDateLoose(s: string): string | null {
  // Normalise separators and try DATE_RX first
  const cleaned = s.trim().replace(/\s+/g, " ");
  const m = cleaned.match(DATE_RX);
  if (m) return isoFromMatch(m);
  // "31 March 2025" form
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\s.\-/]+([A-Za-z]{3,9})[\s.\-/,]+(\d{2,4})$/);
  if (ddmmyyyy) return isoFromMatch(ddmmyyyy as RegExpMatchArray);
  return null;
}

function addOneDayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Parse the "as of" date from a balance sheet / trial balance and decide the
 * opening-balance posting date.
 *
 * Indian convention:
 *   - A balance sheet "as at 31-Mar-YYYY" represents CLOSING balances of
 *     FY (YYYY-1)–YYYY. The OPENING balances of the next FY (YYYY)–(YYYY+1)
 *     equal those closing balances dated 01-Apr-YYYY.
 *   - A balance sheet dated 01-Apr-YYYY represents the OPENING balances of
 *     FY YYYY–(YYYY+1) directly (no shift needed).
 *   - For any other intermediate date, opening = next day.
 */
export function detectAsOfDate(text: string, fallback?: string): AsOfDateInfo {
  const t = normaliseOpeningText(text);

  let phrase: string | null = null;
  let iso: string | null = null;

  for (const rx of AS_OF_RXES) {
    const m = t.match(rx);
    if (!m) continue;
    if (m.length === 4 && /^[A-Za-z]/.test(m[2])) {
      // "31st March 2025" form
      iso = parseDateLoose(`${m[1]} ${m[2]} ${m[3]}`);
    } else {
      iso = parseDateLoose(m[1]);
    }
    if (iso) {
      phrase = m[0];
      break;
    }
  }

  // Fallback: any standalone DD-MM-YYYY appearing in the first 400 chars (header).
  if (!iso) {
    const head = t.slice(0, 400);
    const m = head.match(DATE_RX);
    if (m) {
      iso = isoFromMatch(m);
      if (iso) phrase = m[0];
    }
  }

  if (!iso) {
    const fb = fallback || new Date().toISOString().slice(0, 10);
    return { asOfDate: null, openingDate: fb, isFinancialYearEnd: false, matchedPhrase: null };
  }

  const [, mo, dd] = iso.split("-");
  const isFyEnd = mo === "03" && dd === "31";
  const isAprilFirst = mo === "04" && dd === "01";

  // 01-Apr → that IS the opening date already.
  // Anything else (including 31-Mar) → opening = next day.
  const openingDate = isAprilFirst ? iso : addOneDayIso(iso);

  return { asOfDate: iso, openingDate, isFinancialYearEnd: isFyEnd, matchedPhrase: phrase };
}

function isOpeningGroupLabel(name: string): boolean {
  return GROUP_HEADINGS.some((heading) => heading.rx.test(name));
}

function removeOpeningSubtotalRows(rows: ExtractedOpening[]): ExtractedOpening[] {
  const tolerance = 0.75;
  return rows.filter((row, index) => {
    if (/^(grand\s+total|sub.?total|totals?)$/i.test(row.account_name)) return false;
    if (isOpeningGroupLabel(row.account_name)) {
      const next = rows[index + 1];
      if (next && next.side === row.side && next.amount <= row.amount + tolerance) return false;
    }

    let sum = 0;
    let childCount = 0;
    for (let i = index + 1; i < rows.length; i += 1) {
      const next = rows[i];
      if (next.side !== row.side || /^(grand\s+total|sub.?total|totals?)$/i.test(next.account_name)) break;
      if (next.amount > row.amount + tolerance) break;
      sum += next.amount;
      childCount += 1;
      if (Math.abs(sum - row.amount) <= tolerance) return false;
      if (sum > row.amount + tolerance) break;
    }

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
  let currentSection = "";
  let previousEnd = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const prefix = focused.slice(previousEnd, index).replace(/\s+/g, " ").trim();
    previousEnd = index + match[0].length;

    const stripped = stripOpeningContext(prefix, currentSide);
    currentSide = stripped.side;
    if (stripped.section) currentSection = stripped.section;
    let name = stripped.name.replace(/\s+(dr|cr|debit|credit)\.?$/i, "").trim();

    if (!name || name.length < 2) continue;
    if (/^(grand\s+total|sub.?total|totals?)$/i.test(name)) continue;

    const value = num(match[0]);
    if (!value || Math.abs(value) < 0.01) continue;

    let side = stripped.side;
    if (value < 0) side = side === "Dr" ? "Cr" : "Dr";
    out.push({ account_name: name, amount: Math.abs(value), side, section_hint: currentSection });
  }

  return dedupeOpenings(removeOpeningSubtotalRows(out));
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
  let currentSection = "";

  for (const raw of lines) {
    if (SKIP_LINE_RX.test(raw)) continue;
    if (TOTAL_LINE_RX.test(raw)) continue;

    // Section heading: sets the side for following detail rows. Heading lines
    // typically have NO numbers, or only a single group-total number.
    const headingHit = GROUP_HEADINGS.find((h) => h.rx.test(raw));
    const numericTokens = raw.match(AMOUNT_TOKEN_RX) || [];

    if (headingHit) {
      currentSide = headingHit.side;
      if (headingHit.group) currentSection = headingHit.group;
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

    out.push({ account_name: name, amount, side, section_hint: currentSection });
  }

  if (out.length <= 1 || /sources?\s+of\s+funds|application(s)?\s+of\s+funds/i.test(normalised)) {
    const paragraphRows = parseRunOnOpeningBalanceText(normalised);
    if (paragraphRows.length > out.length) return paragraphRows;
  }

  return dedupeOpenings(out);
}

// ============================================================================
// Opening Stock parser — Item name, HSN, Qty, Unit, Rate, Value
// ============================================================================
export interface ExtractedStockItem {
  name: string;
  hsn_code: string;
  qty: number;
  unit: string;
  rate: number;   // ₹ per unit
  value: number;  // ₹ total
}

const KNOWN_UNITS = [
  "NOS", "PCS", "KGS", "KG", "GMS", "GM", "LTR", "LTRS", "L", "MTR", "MTRS", "M",
  "BOX", "PKT", "BAG", "BTL", "DOZ", "ROL", "SET", "SQM", "SQF", "TON", "UNT",
];
const UNIT_RX = new RegExp(`\\b(${KNOWN_UNITS.join("|")})\\b`, "i");

function normUnit(u: string): string {
  const x = u.toUpperCase();
  if (x === "KG") return "KGS";
  if (x === "GM") return "GMS";
  if (x === "L" || x === "LTRS") return "LTR";
  if (x === "M" || x === "MTRS") return "MTR";
  return x;
}

/**
 * Heuristic line parser for an opening-stock / item summary document.
 * Each non-empty line is treated as one item. We pull:
 *   - HSN: first 4-8 digit pure numeric token
 *   - Unit: first matching unit token
 *   - Numeric tail: last 3 numbers → qty, rate, value (or last 2 → qty + value)
 *   - Name: text before the HSN / first numeric / unit token
 */
export function parseStockOpeningText(text: string): ExtractedStockItem[] {
  const out: ExtractedStockItem[] = [];
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  for (const raw of lines) {
    // Skip header-ish lines
    if (/^(s\.?\s*no|sr\.?\s*no|item|particulars|description|hsn|qty|quantity|rate|value|amount|total)\b/i.test(raw)) continue;
    if (!/\d/.test(raw)) continue;

    // HSN: 4, 6 or 8 digit standalone number — pick the first that isn't an obvious amount.
    let hsn = "";
    const hsnMatch = raw.match(/\b(\d{4}|\d{6}|\d{8})\b/);
    if (hsnMatch) hsn = hsnMatch[1];

    // Unit
    let unit = "NOS";
    const um = raw.match(UNIT_RX);
    if (um) unit = normUnit(um[1]);

    // Numeric amounts (qty / rate / value) — capture tokens like 1,234.50 or 12.000
    const numTokens = raw.match(/-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+\.\d+|-?\d+/g) || [];
    // Drop the HSN token from numeric amounts (HSN is usually integer 4/6/8 digits with no comma/decimal)
    const amounts = numTokens
      .filter((t) => t !== hsn)
      .map(num)
      .filter((n) => isFinite(n) && n !== 0);
    if (amounts.length < 2) continue;

    let qty = 0, rate = 0, value = 0;
    if (amounts.length >= 3) {
      [qty, rate, value] = amounts.slice(-3);
    } else {
      qty = amounts[amounts.length - 2];
      value = amounts[amounts.length - 1];
      rate = qty > 0 ? value / qty : 0;
    }
    if (qty <= 0 || value <= 0) continue;

    // Name: strip HSN, unit, and trailing numeric tokens
    let name = raw;
    if (hsn) name = name.replace(new RegExp(`\\b${hsn}\\b`), " ");
    name = name.replace(UNIT_RX, " ");
    // remove trailing run of "<num> <num> <num>"
    name = name.replace(/(\s-?\d[\d,\.]*){2,}\s*$/, "").trim();
    name = name.replace(/[\|\.]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (name.length < 2) continue;

    out.push({ name, hsn_code: hsn, qty: Math.abs(qty), unit, rate: Math.abs(rate), value: Math.abs(value) });
  }
  return out;
}
