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

/**
 * Parse OCR text from a trial balance / balance sheet image.
 * Heuristic: each line = "<Account name> <amount> [Dr|Cr]"
 * or two-column layout: "<Account> <Debit> <Credit>" (one is 0/blank).
 */
export function parseTrialBalanceText(text: string): ExtractedOpening[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 4);

  const out: ExtractedOpening[] = [];
  for (const raw of lines) {
    // Skip headings
    if (/^(particulars|account|ledger|trial balance|balance sheet|total|grand total|sub.?total)\b/i.test(raw))
      continue;

    const tokens = raw.match(/[-]?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|[-]?\d+(?:\.\d{1,2})?/g) || [];
    if (tokens.length === 0) continue;

    const tail = tokens.slice(-2).map(num);
    const sideMatch = raw.match(/\b(Dr|Cr|Debit|Credit)\b\.?\s*$/i);
    let side: "Dr" | "Cr" | null = null;
    if (sideMatch) side = /^d/i.test(sideMatch[1]) ? "Dr" : "Cr";

    let amount = 0;
    if (tail.length === 2 && tail[0] && !tail[1]) { amount = tail[0]; side = side ?? "Dr"; }
    else if (tail.length === 2 && !tail[0] && tail[1]) { amount = tail[1]; side = side ?? "Cr"; }
    else if (tail.length === 2 && tail[0] && tail[1]) {
      // Both nonzero → take larger and infer side
      if (tail[0] >= tail[1]) { amount = tail[0]; side = side ?? "Dr"; }
      else { amount = tail[1]; side = side ?? "Cr"; }
    } else {
      amount = tail[tail.length - 1];
      side = side ?? "Dr";
    }
    if (!amount) continue;

    // Account name = everything before the first numeric token
    const firstNumIdx = raw.search(/[-]?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|[-]?\d+(?:\.\d{1,2})?/);
    let name = (firstNumIdx > 0 ? raw.slice(0, firstNumIdx) : raw).trim();
    name = name.replace(/[:\-|]+$/g, "").trim();
    if (name.length < 2) continue;

    out.push({ account_name: name, amount, side });
  }
  return out;
}
