// Bank statement CSV parser + matching heuristics.
// Expected columns (case-insensitive, common Indian bank exports):
// Date | Description | Ref/Cheque | Debit | Credit | Balance
export interface ParsedBankLine {
  txn_date: string; // YYYY-MM-DD
  description: string;
  reference: string;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number | null;
}

function toIsoDate(s: string): string | null {
  const t = s.trim();
  // dd/mm/yyyy or dd-mm-yyyy
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  // yyyy-mm-dd
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function toPaise(s: string): number {
  if (!s) return 0;
  const n = Number(s.replace(/[, ]/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseBankCsv(text: string): ParsedBankLine[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = idx(["date", "txn date", "value date"]);
  const iDesc = idx(["description", "narration", "particulars", "remarks"]);
  const iRef = idx(["ref", "cheque", "chq"]);
  const iDr = idx(["debit", "withdrawal", "dr"]);
  const iCr = idx(["credit", "deposit", "cr"]);
  const iBal = idx(["balance"]);

  const rows: ParsedBankLine[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const iso = iDate >= 0 ? toIsoDate(cells[iDate] || "") : null;
    if (!iso) continue;
    rows.push({
      txn_date: iso,
      description: (iDesc >= 0 ? cells[iDesc] : "").trim(),
      reference: (iRef >= 0 ? cells[iRef] : "").trim(),
      debit_paise: iDr >= 0 ? toPaise(cells[iDr]) : 0,
      credit_paise: iCr >= 0 ? toPaise(cells[iCr]) : 0,
      balance_paise: iBal >= 0 && cells[iBal] ? toPaise(cells[iBal]) : null,
    });
  }
  return rows;
}

export interface VoucherCandidate {
  id: string;
  voucher_date: string;
  voucher_number: string;
  reference_no: string | null;
  total_paise: number;
  voucher_type: string;
}

// Returns best candidate match id or null. Heuristic: same amount within ±7 days,
// optional reference substring boost.
export function suggestMatch(line: ParsedBankLine, candidates: VoucherCandidate[]): string | null {
  const target = line.debit_paise > 0 ? line.debit_paise : line.credit_paise;
  if (!target) return null;
  let best: { id: string; score: number } | null = null;
  const lineDate = new Date(line.txn_date).getTime();
  for (const c of candidates) {
    if (c.total_paise !== target) continue;
    const diffDays = Math.abs((new Date(c.voucher_date).getTime() - lineDate) / 86_400_000);
    if (diffDays > 7) continue;
    let score = 100 - diffDays * 5;
    if (c.reference_no && line.reference && c.reference_no.includes(line.reference)) score += 30;
    if (line.description.toLowerCase().includes(c.voucher_number.toLowerCase())) score += 25;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}
