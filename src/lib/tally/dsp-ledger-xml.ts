// Parser for Tally "Ledger Vouchers" / statement XML exports (the display-tag
// format: LVACCTITLE, DSPVCHDATE, DSPVCHLEDACCOUNT, DSPVCHDRAMT, DSPVCHCRAMT,
// DSPEXPLVCHNUMBER ...). Each <LVACCTITLE> starts one account statement.
//
// Sign rule (verified against the file's own closing totals): a negative
// amount is a DEBIT and a positive amount is a CREDIT, for both the opening
// balance and every entry. The DR column is always <= 0 and the CR column is
// always >= 0 in these exports.
//
// Pure module: no database, no DOM. Reads a stream in pieces so files well
// over 100 MB never need to be held as one string.

export interface DspEntry {
  /** Other side of the voucher as printed by Tally (DSPVCHLEDACCOUNT). */
  counter: string;
  /** Voucher date, ISO yyyy-mm-dd. */
  date: string;
  /** Tally voucher type text, e.g. "Sale", "Rcpt", "Purc", "Pymt", "Jrnl". */
  type: string;
  /** Voucher number text, e.g. "55/25-26" (empty when Tally printed none). */
  number: string;
  /** Signed amount in rupees: negative = debit to this ledger, positive = credit. */
  amount: number;
}

export interface DspBlock {
  /** Account name (LVACCTITLE). */
  ledger: string;
  /** Opening balance in rupees, same sign rule. Undefined when not printed. */
  opening?: number;
  entries: DspEntry[];
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "1-Apr-25" -> "2025-04-01". Returns "" when the text is not a date. */
export function parseTallyDate(text: string): string {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return "";
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return "";
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yy}-${month}-${m[1].padStart(2, "0")}`;
}

/** "(No. :55/25-26)" -> "55/25-26". "(No. :16)" -> "16". */
export function parseVoucherNumber(text: string): string {
  const m = /No\.\s*:\s*([^)]*?)\s*\)?\s*$/.exec(text);
  return (m ? m[1] : text).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

const TAG_RE = /<(LVACCTITLE|DSPVCHDATE|DSPVCHLEDACCOUNT|DSPVCHTYPE|DSPVCHDRAMT|DSPVCHCRAMT|DSPEXPLVCHNUMBER)>([^<]*)<\/\1>/g;

/** Parse one account statement (text from one <LVACCTITLE> up to the next). */
export function parseDspBlock(text: string): DspBlock | null {
  const titleMatch = /<LVACCTITLE>([^<]*)<\/LVACCTITLE>/.exec(text);
  if (!titleMatch) return null;
  const block: DspBlock = { ledger: decodeEntities(titleMatch[1]).trim(), entries: [] };

  let cur: { date?: string; counter?: string; type?: string; number?: string; dr?: string; cr?: string } | null = null;
  const flush = () => {
    if (!cur || !cur.date) { cur = null; return; }
    const drText = (cur.dr ?? "").trim();
    const crText = (cur.cr ?? "").trim();
    const raw = drText !== "" ? Number(drText) : crText !== "" ? Number(crText) : NaN;
    if (Number.isFinite(raw)) {
      const counter = cur.counter ?? "";
      if (counter === "Opening Balance") {
        block.opening = raw;
      } else {
        block.entries.push({
          counter,
          date: cur.date,
          type: cur.type ?? "",
          number: cur.number ?? "",
          amount: raw,
        });
      }
    }
    cur = null;
  };

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    const [, name, raw] = m;
    const value = decodeEntities(raw).trim();
    if (name === "DSPVCHDATE") {
      flush();
      cur = { date: parseTallyDate(value) };
      continue;
    }
    if (name === "LVACCTITLE") continue;
    if (!cur) continue;
    if (name === "DSPVCHLEDACCOUNT") cur.counter = value;
    else if (name === "DSPVCHTYPE") cur.type = value;
    else if (name === "DSPEXPLVCHNUMBER") cur.number = parseVoucherNumber(value);
    else if (name === "DSPVCHDRAMT") cur.dr = value;
    else if (name === "DSPVCHCRAMT") cur.cr = value;
  }
  flush();
  return block;
}

const BLOCK_MARK = "<LVACCTITLE>";

/**
 * Stream a Tally ledger-statement XML file block by block. Only one account
 * statement is held in memory at a time. Returns the number of blocks read.
 */
export async function parseDspStream(
  stream: ReadableStream<Uint8Array>,
  onBlock: (block: DspBlock) => void,
): Promise<number> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buf = "";
  let count = 0;

  const emitComplete = (text: string) => {
    const parts = text.split(BLOCK_MARK);
    for (let i = 1; i < parts.length; i++) {
      const block = parseDspBlock(BLOCK_MARK + parts[i]);
      if (block) { onBlock(block); count++; }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Everything before the last block marker is complete.
    const cut = buf.lastIndexOf(BLOCK_MARK);
    if (cut > 0) {
      emitComplete(buf.slice(0, cut));
      buf = buf.slice(cut);
    }
  }
  buf += decoder.decode();
  emitComplete(buf);
  return count;
}

/** Parse a whole XML string (tests and small files). */
export function parseDspText(xml: string): DspBlock[] {
  const blocks: DspBlock[] = [];
  const parts = xml.split(BLOCK_MARK);
  for (let i = 1; i < parts.length; i++) {
    const block = parseDspBlock(BLOCK_MARK + parts[i]);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** True when the text looks like a Tally ledger-statement export. */
export function looksLikeDspExport(head: string): boolean {
  return head.includes("<LVACCTITLE>") && (head.includes("<DSPVCHDATE>") || head.includes("<DSPVCHLEDACCOUNT>"));
}
