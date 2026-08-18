// Web Worker: parse CSV or XLSX bank statement off the main thread.
// Uses papaparse (streaming) for CSV, xlsx for spreadsheet formats.
// Never touches the network. Returns normalized ParsedBankLine[].
/// <reference lib="webworker" />

import Papa from "papaparse";
import type * as XLSXType from "xlsx";

export interface ParsedBankLine {
  txn_date: string;
  description: string;
  reference: string;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number | null;
}

export type ParseRequest =
  | { kind: "csv"; text: string }
  | { kind: "xlsx"; buffer: ArrayBuffer };

export interface ParseResponse {
  ok: boolean;
  rows: ParsedBankLine[];
  error?: string;
  detected: { dateCol: string | null; descCol: string | null; drCol: string | null; crCol: string | null };
  rejectedCount: number;
}

function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  // Excel numeric date
  if (typeof v === "number" && isFinite(v)) {
    const XLSX = (self as any).XLSX;
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // dd-MMM-yyyy (SBI/ICICI)
  m = s.match(/^(\d{1,2})[\-\s]([A-Za-z]{3})[\-\s](\d{2,4})$/);
  if (m) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const mi = months.indexOf(m[2].toLowerCase());
    if (mi >= 0) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

function toPaise(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) : 0;
  const s = String(v).replace(/[₹,\s]/g, "").replace(/\(([\d.]+)\)/, "-$1");
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) : 0;
}

function findCol(header: string[], names: string[]): number {
  return header.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
}

function rowsFromMatrix(matrix: string[][]): ParseResponse {
  // Locate the header row: first row containing "date" AND one of debit/credit/withdrawal/deposit/amount.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const cells = (matrix[i] || []).map((c) => String(c ?? "").toLowerCase());
    const hasDate = cells.some((c) => c.includes("date"));
    const hasAmt = cells.some((c) => /debit|credit|withdraw|deposit|amount|dr|cr/.test(c));
    if (hasDate && hasAmt) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    return { ok: false, rows: [], error: "Could not find a header row with Date + Debit/Credit columns.", detected: { dateCol: null, descCol: null, drCol: null, crCol: null }, rejectedCount: 0 };
  }
  const header = (matrix[headerIdx] || []).map((c) => String(c ?? "").trim());
  const iDate = findCol(header, ["date"]);
  const iDesc = findCol(header, ["narration", "description", "particulars", "remarks", "details"]);
  const iRef = findCol(header, ["chq", "cheque", "ref"]);
  const iDr = findCol(header, ["debit", "withdrawal", "withdraw"]);
  const iCr = findCol(header, ["credit", "deposit"]);
  const iAmt = iDr < 0 && iCr < 0 ? findCol(header, ["amount"]) : -1;
  const iType = iAmt >= 0 ? findCol(header, ["type", "dr/cr", "dc"]) : -1;
  const iBal = findCol(header, ["balance"]);

  const rows: ParsedBankLine[] = [];
  let rejected = 0;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (cells.every((c) => c == null || String(c).trim() === "")) continue;
    const iso = iDate >= 0 ? toIsoDate(cells[iDate]) : null;
    if (!iso) { rejected++; continue; }
    let dr = iDr >= 0 ? toPaise(cells[iDr]) : 0;
    let cr = iCr >= 0 ? toPaise(cells[iCr]) : 0;
    if (iAmt >= 0) {
      const amt = toPaise(cells[iAmt]);
      const typ = iType >= 0 ? String(cells[iType] ?? "").toLowerCase() : "";
      if (/dr|debit|w/.test(typ) || amt < 0) dr = Math.abs(amt);
      else cr = Math.abs(amt);
    }
    if (dr === 0 && cr === 0) { rejected++; continue; }
    rows.push({
      txn_date: iso,
      description: iDesc >= 0 ? String(cells[iDesc] ?? "").trim() : "",
      reference: iRef >= 0 ? String(cells[iRef] ?? "").trim() : "",
      debit_paise: dr,
      credit_paise: cr,
      balance_paise: iBal >= 0 && cells[iBal] != null && cells[iBal] !== "" ? toPaise(cells[iBal]) : null,
    });
  }
  return {
    ok: true, rows, rejectedCount: rejected,
    detected: {
      dateCol: iDate >= 0 ? header[iDate] : null,
      descCol: iDesc >= 0 ? header[iDesc] : null,
      drCol: iDr >= 0 ? header[iDr] : (iAmt >= 0 ? header[iAmt] : null),
      crCol: iCr >= 0 ? header[iCr] : null,
    },
  };
}

self.onmessage = async (ev: MessageEvent<ParseRequest>) => {
  try {
    const req = ev.data;
    let matrix: string[][] = [];
    if (req.kind === "csv") {
      const res = Papa.parse<string[]>(req.text, { skipEmptyLines: true });
      matrix = (res.data || []) as string[][];
    } else {
      const XLSX = await import("xlsx");
      (self as any).XLSX = XLSX;
      const wb = XLSX.read(req.buffer, { type: "array", cellDates: false });
      const first = wb.SheetNames[0];
      if (!first) throw new Error("Workbook has no sheets.");
      matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[first], { header: 1, blankrows: false, raw: true }) as unknown as string[][];
    }
    const out = rowsFromMatrix(matrix);
    (self as unknown as Worker).postMessage(out);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false, rows: [], error: err instanceof Error ? err.message : String(err),
      detected: { dateCol: null, descCol: null, drCol: null, crCol: null }, rejectedCount: 0,
    } satisfies ParseResponse);
  }
};

export {}; // module worker
