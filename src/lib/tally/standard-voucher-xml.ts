// Parser for Tally standard XML exports (<ENVELOPE> / <TALLYMESSAGE> /
// <VOUCHER>), as produced by Day Book or Voucher Register "Export as XML".
//
// Sign rule (same as the ledger-statement format): a negative AMOUNT is a
// DEBIT and a positive AMOUNT is a CREDIT. The sign of AMOUNT decides the side,
// not ISDEEMEDPOSITIVE. Verified on the sample files: every voucher balances
// with this rule, and the few rows where the two disagree are round-off lines.
//
// Where the ledger lines come from:
//   - LEDGERENTRIES.LIST / ALLLEDGERENTRIES.LIST: one line per ledger.
//   - ALLINVENTORYENTRIES.LIST: a stock line. Its sales/purchase ledger (for
//     example SALES GST) is in ACCOUNTINGALLOCATIONS.LIST, not in the list above.
//     Those allocations are the ledger lines for the stock value.
//   A voucher never lists the same ledger in both places (checked on the
//   samples). If it did, the balance check in the importer would fail the
//   voucher rather than post it twice.
//
// Pure module: no database, no DOM. Works on one <VOUCHER> at a time, and
// streams the file so only one voucher is in memory.

import { decodeXmlText } from "@/lib/tally/xml-text";

export interface StdLine {
  ledger: string;
  /** Tally sign: negative = debit, positive = credit. */
  amount: number;
}

export interface StdItemLine {
  name: string;
  /** Billed quantity and its unit, e.g. 180 "Kgs". */
  qty?: number;
  unit?: string;
  /** Rate as printed, e.g. "315.44/Kgs" -> 315.44 and unit "Kgs". */
  rate?: number;
  rate_unit?: string;
  /** Value of the line in the same sign rule as the ledger lines. */
  amount: number;
  hsn?: string;
  /** Total GST rate in percent (IGST, or CGST + SGST/UTGST). */
  gst_rate?: number;
}

export interface StdVoucher {
  vch_type: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  number: string;
  party: string;
  narration: string;
  /** False for cancelled, optional or deleted vouchers. They are not imported. */
  active: boolean;
  lines: StdLine[];
  items: StdItemLine[];
}

interface XNode {
  name: string;
  attrs: string;
  text: string;
  kids: XNode[];
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
const VOUCHER_START = /<VOUCHER[\s>]/g;
const VOUCHER_END = "</VOUCHER>";

/** Build a small element tree from one voucher's text. Tolerant of stray text. */
export function parseXmlTree(xml: string): XNode {
  const root: XNode = { name: "", attrs: "", text: "", kids: [] };
  const stack: XNode[] = [root];
  const re = new RegExp(TAG_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[5] !== undefined) {
      stack[stack.length - 1].text += decodeXmlText(m[5]);
      continue;
    }
    const closing = m[1] === "/";
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: XNode = { name: m[2], attrs: m[3], text: "", kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (m[4] !== "/") stack.push(node);
  }
  return root;
}

const kidsNamed = (n: XNode, name: string) => n.kids.filter((k) => k.name === name);
const valueOf = (n: XNode, name: string): string => {
  const k = n.kids.find((c) => c.name === name);
  return k ? k.text.trim() : "";
};
const attrOf = (n: XNode, attr: string): string => {
  const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(n.attrs);
  return m ? decodeXmlText(m[1]).trim() : "";
};

/** "-67000.00" -> -67000. Blank or non-numeric -> NaN. */
export function parseTallyAmount(text: string): number {
  const t = text.replace(/,/g, "").trim();
  return t === "" ? NaN : Number(t);
}

/** "20260401" -> "2026-04-01". Empty string when not in that form. */
export function parseCompactDate(text: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** " 180.00 Kgs =  1 PCS" -> { qty: 180, unit: "Kgs" }. */
export function parseQuantity(text: string): { qty?: number; unit?: string } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([^=]*?)\s*(?:=|$)/.exec(text);
  if (!m) return {};
  return { qty: Number(m[1]), unit: m[2] || undefined };
}

/** "315.44/Kgs" -> { rate: 315.44, rate_unit: "Kgs" }. */
export function parseRate(text: string): { rate?: number; rate_unit?: string } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*(.*?))?\s*$/.exec(text);
  if (!m) return {};
  return { rate: Number(m[1]), rate_unit: m[2] || undefined };
}

function gstRateOf(item: XNode): number | undefined {
  let igst: number | undefined;
  let cgst: number | undefined;
  let sgst: number | undefined;
  for (const d of kidsNamed(item, "RATEDETAILS.LIST")) {
    const head = valueOf(d, "GSTRATEDUTYHEAD").toUpperCase();
    const rate = parseTallyAmount(valueOf(d, "GSTRATE"));
    if (!Number.isFinite(rate)) continue;
    if (head === "IGST") igst = rate;
    else if (head === "CGST") cgst = rate;
    else if (head === "SGST/UTGST" || head === "SGST") sgst = rate;
  }
  if (igst !== undefined) return igst;
  if (cgst !== undefined || sgst !== undefined) return (cgst ?? 0) + (sgst ?? 0);
  return undefined;
}

function ledgerLinesOf(list: XNode, out: StdLine[]) {
  const ledger = valueOf(list, "LEDGERNAME");
  const amount = parseTallyAmount(valueOf(list, "AMOUNT"));
  if (ledger && Number.isFinite(amount)) out.push({ ledger, amount });
}

/**
 * Parse one <VOUCHER> element. Returns null when the text has no voucher in it.
 * Cancelled, optional and deleted vouchers are returned with active = false.
 */
export function parseStandardVoucher(xml: string): StdVoucher | null {
  const root = parseXmlTree(xml);
  const v = root.kids.find((k) => k.name === "VOUCHER");
  if (!v) return null;

  const lines: StdLine[] = [];
  const items: StdItemLine[] = [];

  for (const k of v.kids) {
    if (k.name === "LEDGERENTRIES.LIST" || k.name === "ALLLEDGERENTRIES.LIST") {
      ledgerLinesOf(k, lines);
    } else if (k.name === "ALLINVENTORYENTRIES.LIST" || k.name === "INVENTORYENTRIES.LIST") {
      const name = valueOf(k, "STOCKITEMNAME");
      const billed = parseQuantity(valueOf(k, "BILLEDQTY") || valueOf(k, "ACTUALQTY"));
      const rate = parseRate(valueOf(k, "RATE"));
      const amount = parseTallyAmount(valueOf(k, "AMOUNT"));
      const hsn = valueOf(k, "GSTHSNNAME");
      if (name) {
        items.push({
          name,
          qty: billed.qty,
          unit: billed.unit,
          rate: rate.rate,
          rate_unit: rate.rate_unit,
          amount: Number.isFinite(amount) ? amount : 0,
          hsn: hsn || undefined,
          gst_rate: gstRateOf(k),
        });
      }
      for (const alloc of kidsNamed(k, "ACCOUNTINGALLOCATIONS.LIST")) ledgerLinesOf(alloc, lines);
    }
  }

  const cancelled = valueOf(v, "ISCANCELLED") === "Yes"
    || valueOf(v, "ISOPTIONAL") === "Yes"
    || valueOf(v, "ISDELETED") === "Yes"
    || attrOf(v, "ACTION") === "Delete";

  return {
    vch_type: valueOf(v, "VOUCHERTYPENAME") || attrOf(v, "VCHTYPE"),
    date: parseCompactDate(valueOf(v, "DATE")),
    number: valueOf(v, "VOUCHERNUMBER"),
    party: valueOf(v, "PARTYLEDGERNAME") || valueOf(v, "PARTYNAME"),
    narration: valueOf(v, "NARRATION"),
    active: !cancelled,
    lines,
    items,
  };
}

const TRAIL = 16; // enough to keep a partial "<VOUCHER" at the end of a chunk

/**
 * Stream vouchers from text chunks. Each complete <VOUCHER>...</VOUCHER> is
 * parsed and handed to onVoucher; the buffer keeps only the unfinished tail.
 * Returns the number of vouchers read.
 */
export async function parseStandardVouchers(
  chunks: AsyncIterable<string>,
  onVoucher: (v: StdVoucher) => void,
): Promise<number> {
  let buf = "";
  let count = 0;
  for await (const chunk of chunks) {
    buf += chunk;
    let pos = 0;
    for (;;) {
      VOUCHER_START.lastIndex = pos;
      const start = VOUCHER_START.exec(buf);
      if (!start) break;
      const end = buf.indexOf(VOUCHER_END, start.index);
      if (end < 0) break;
      const stop = end + VOUCHER_END.length;
      const voucher = parseStandardVoucher(buf.slice(start.index, stop));
      if (voucher) { onVoucher(voucher); count++; }
      pos = stop;
    }
    // Keep from the next unfinished voucher; otherwise keep only a short tail.
    VOUCHER_START.lastIndex = pos;
    const next = VOUCHER_START.exec(buf);
    buf = next ? buf.slice(next.index) : buf.slice(Math.max(pos, buf.length - TRAIL));
  }
  return count;
}

/** True when the head of a file looks like a standard Tally XML export. */
export function looksLikeStandardVoucherXml(head: string): boolean {
  return head.includes("<TALLYMESSAGE") || /<VOUCHER[\s>]/.test(head);
}
