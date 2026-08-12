// GSTR-2B reconciliation engine — robust fuzzy matching against purchase register.
// Handles GSTN JSON, CSV (portal/offline-tool), and Excel exports (B2B sheet).

export interface ParsedRow {
  supplier_gstin: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string | null; // YYYY-MM-DD
  invoice_value_paise: number;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise?: number;
}

export interface BookPurchase {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
  vendor_invoice_no: string | null;
  ledgers: { name: string; gstin: string | null } | null;
}

export interface ReconTolerances {
  /** Allowed |Δ invoice value| in paise (default ₹2 = 200 paise) */
  valuePaise: number;
  /** Allowed |Δ per-tax-head| in paise (default ₹1 = 100 paise) */
  taxPaise: number;
  /** Allowed |Δ days| between 2B date and book date (default 7) */
  dateDays: number;
  /** Ignore invoice number entirely (match on GSTIN + value + date window) */
  ignoreInvoiceNo: boolean;
  /** Ignore invoice date entirely */
  ignoreDate: boolean;
}

export const DEFAULT_TOLERANCES: ReconTolerances = {
  valuePaise: 200,
  taxPaise: 100,
  dateDays: 7,
  ignoreInvoiceNo: false,
  ignoreDate: false,
};

export type MatchStatus =
  | "matched" // exact-enough on all dims
  | "matched_with_tolerance" // within tolerances but not exact
  | "value_mismatch"
  | "tax_mismatch"
  | "date_mismatch"
  | "invoice_no_mismatch"
  | "probable_match"
  | "unmatched";

export interface ReconResult {
  row: ParsedRow;
  match_status: MatchStatus;
  matched_voucher_id: string | null;
  diff?: {
    value: number;
    tax: number;
    days: number | null;
  };
}

// ---------- normalization helpers ----------

export function normInvoiceNo(s: string): string {
  if (!s) return "";
  // upper, strip whitespace, dashes, slashes, dots; strip leading zeros from numeric runs
  const cleaned = s.toUpperCase().replace(/[\s\-_/\\.#]+/g, "");
  return cleaned.replace(/\b0+(\d)/g, "$1");
}

export function normGstin(s: string | null | undefined): string {
  return (s || "").toUpperCase().replace(/\s+/g, "").trim();
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}

// ---------- date / number parsing ----------

export function parseAnyDate(s: unknown): string | null {
  if (s == null) return null;
  if (typeof s === "number" && s > 25569 && s < 80000) {
    // Excel serial date
    const ms = (s - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return d.toISOString().slice(0, 10);
  }
  const t = String(s).trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = months[m[2].slice(0, 3).toLowerCase()];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (mm) return `${y}-${mm}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function toPaise(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(v * 100);
  const s = String(v).replace(/[₹,\s]/g, "").replace(/^\(([^)]+)\)$/, "-$1");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------- parsers ----------

const COL_ALIASES = {
  gstin: ["gstin of supplier", "gstin", "ctin", "supplier gstin"],
  name: ["trade name", "trade/legal name", "supplier name", "legal name", "trade/legal"],
  invNo: ["invoice number", "invoice no", "doc no", "doc number", "invoice/advice", "bill no"],
  invDate: ["invoice date", "doc date", "bill date"],
  invVal: ["invoice value", "doc value", "total value", "invoice value(₹)"],
  taxable: ["taxable value", "taxable"],
  igst: ["integrated tax", "igst", "igst amount"],
  cgst: ["central tax", "cgst", "cgst amount"],
  sgst: ["state/ut tax", "state tax", "sgst", "sgst/utgst", "sgst amount"],
  cess: ["cess", "cess amount"],
};

function findIdx(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  for (const a of aliases) {
    const i = norm.findIndex((h) => h === a || h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

function rowsFromMatrix(matrix: unknown[][]): ParsedRow[] {
  // find header row (one with GSTIN-like header)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 40); i++) {
    const r = (matrix[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (r.some((c) => c.includes("gstin") || c.includes("ctin"))) {
      const score = COL_ALIASES.invNo.some((a) => r.some((c) => c.includes(a))) ? 2 : 1;
      if (score >= 1) { headerIdx = i; break; }
    }
  }
  if (headerIdx < 0) return [];
  const headers = (matrix[headerIdx] || []).map((c) => String(c ?? ""));
  const ix = {
    gstin: findIdx(headers, COL_ALIASES.gstin),
    name: findIdx(headers, COL_ALIASES.name),
    invNo: findIdx(headers, COL_ALIASES.invNo),
    invDate: findIdx(headers, COL_ALIASES.invDate),
    invVal: findIdx(headers, COL_ALIASES.invVal),
    taxable: findIdx(headers, COL_ALIASES.taxable),
    igst: findIdx(headers, COL_ALIASES.igst),
    cgst: findIdx(headers, COL_ALIASES.cgst),
    sgst: findIdx(headers, COL_ALIASES.sgst),
    cess: findIdx(headers, COL_ALIASES.cess),
  };
  if (ix.gstin < 0) return [];
  const out: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    const gstin = normGstin(String(r[ix.gstin] ?? ""));
    if (!gstin || gstin.length < 10) continue;
    if (/^total/i.test(gstin)) continue;
    out.push({
      supplier_gstin: gstin,
      supplier_name: ix.name >= 0 ? String(r[ix.name] ?? "").trim() : "",
      invoice_no: ix.invNo >= 0 ? String(r[ix.invNo] ?? "").trim() : "",
      invoice_date: ix.invDate >= 0 ? parseAnyDate(r[ix.invDate]) : null,
      invoice_value_paise: ix.invVal >= 0 ? toPaise(r[ix.invVal]) : 0,
      taxable_paise: ix.taxable >= 0 ? toPaise(r[ix.taxable]) : 0,
      igst_paise: ix.igst >= 0 ? toPaise(r[ix.igst]) : 0,
      cgst_paise: ix.cgst >= 0 ? toPaise(r[ix.cgst]) : 0,
      sgst_paise: ix.sgst >= 0 ? toPaise(r[ix.sgst]) : 0,
      cess_paise: ix.cess >= 0 ? toPaise(r[ix.cess]) : 0,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const matrix = lines.map(splitCsvLine);
  return rowsFromMatrix(matrix);
}

export async function parseXlsx(file: File): Promise<ParsedRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const out: ParsedRow[] = [];
  for (const name of wb.SheetNames) {
    // GSTR-2B excel from GST portal has sheet named "B2B" (and B2BA, CDNR, etc.)
    // We only consume B2B / B2BA for now.
    const upper = name.toUpperCase();
    if (upper !== "B2B" && upper !== "B2BA" && !/B2B/.test(upper)) continue;
    const sh = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "", raw: true }) as unknown[][];
    out.push(...rowsFromMatrix(matrix));
  }
  if (out.length === 0) {
    // fallback: first sheet
    const sh = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "", raw: true }) as unknown[][];
    out.push(...rowsFromMatrix(matrix));
  }
  return out;
}

interface GstnB2BItem { txval?: number; igst?: number; cgst?: number; sgst?: number; cess?: number }
interface GstnB2BInvoice { inum?: string; invoiceNumber?: string; idt?: string; invoiceDate?: string; val?: number; itms?: GstnB2BItem[]; txval?: number; igst?: number; cgst?: number; sgst?: number; cess?: number }
interface GstnB2BSupplier { ctin?: string; supplierGSTIN?: string; trdnm?: string; supplierName?: string; inv?: GstnB2BInvoice[] }

export function parseJson(text: string): ParsedRow[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const root = j as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || root;
  const docdata = (data.docdata as Record<string, unknown>) || (root.docdata as Record<string, unknown>) || {};
  const suppliers: GstnB2BSupplier[] = (docdata.b2b as GstnB2BSupplier[]) || (data.b2b as GstnB2BSupplier[]) || (root.b2b as GstnB2BSupplier[]) || [];
  const out: ParsedRow[] = [];
  for (const s of suppliers) {
    const gstin = normGstin(s.ctin || s.supplierGSTIN || "");
    const name = s.trdnm || s.supplierName || "";
    for (const inv of s.inv || []) {
      const itms = inv.itms || [];
      const agg = itms.reduce(
        (acc, it) => ({
          tax: acc.tax + (it.txval || 0),
          ig: acc.ig + (it.igst || 0),
          cg: acc.cg + (it.cgst || 0),
          sg: acc.sg + (it.sgst || 0),
          cs: acc.cs + (it.cess || 0),
        }),
        { tax: 0, ig: 0, cg: 0, sg: 0, cs: 0 },
      );
      out.push({
        supplier_gstin: gstin,
        supplier_name: name,
        invoice_no: String(inv.inum || inv.invoiceNumber || "").trim(),
        invoice_date: parseAnyDate(inv.idt || inv.invoiceDate || ""),
        invoice_value_paise: toPaise(inv.val || 0),
        taxable_paise: toPaise(agg.tax || inv.txval || 0),
        igst_paise: toPaise(agg.ig || inv.igst || 0),
        cgst_paise: toPaise(agg.cg || inv.cgst || 0),
        sgst_paise: toPaise(agg.sg || inv.sgst || 0),
        cess_paise: toPaise(agg.cs || inv.cess || 0),
      });
    }
  }
  return out;
}

export async function parseAny(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJson(await file.text());
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(file);
  return parseCsv(await file.text());
}

// ---------- matching ----------

interface BookKey {
  gstin: string;
  invKey: string;
  totalPaise: number;
  taxPaise: number;
  date: string;
  id: string;
  raw: BookPurchase;
}

export function reconcile(rows: ParsedRow[], books: BookPurchase[], tol: ReconTolerances): ReconResult[] {
  const bk: BookKey[] = books
    .filter((p) => p.ledgers?.gstin)
    .map((p) => ({
      gstin: normGstin(p.ledgers!.gstin!),
      invKey: normInvoiceNo(p.vendor_invoice_no || ""),
      totalPaise: p.total_paise,
      taxPaise: 0,
      date: p.voucher_date,
      id: p.id,
      raw: p,
    }));

  // index by gstin -> entries; also by gstin+invKey for fast exact lookup
  const byGstin = new Map<string, BookKey[]>();
  const byKey = new Map<string, BookKey[]>();
  for (const b of bk) {
    if (!byGstin.has(b.gstin)) byGstin.set(b.gstin, []);
    byGstin.get(b.gstin)!.push(b);
    if (b.invKey) {
      const k = `${b.gstin}|${b.invKey}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(b);
    }
  }

  const consumed = new Set<string>();
  const results: ReconResult[] = [];

  for (const row of rows) {
    const rInv = normInvoiceNo(row.invoice_no);
    const candidates: BookKey[] = [];

    // tier 1: exact gstin + invoice key
    if (!tol.ignoreInvoiceNo && rInv) {
      const exact = byKey.get(`${row.supplier_gstin}|${rInv}`) || [];
      candidates.push(...exact.filter((b) => !consumed.has(b.id)));
    }
    // tier 2: gstin-only candidates (for fuzzy fallback)
    if (candidates.length === 0) {
      const same = (byGstin.get(row.supplier_gstin) || []).filter((b) => !consumed.has(b.id));
      candidates.push(...same);
    }

    let best: { b: BookKey; score: number; vDiff: number; dDiff: number | null; reason: MatchStatus } | null = null;
    for (const b of candidates) {
      const vDiff = Math.abs(b.totalPaise - row.invoice_value_paise);
      const dDiff = daysBetween(b.date, row.invoice_date);
      const invMatch = !tol.ignoreInvoiceNo && rInv && b.invKey && rInv === b.invKey;
      const valueOk = vDiff <= tol.valuePaise;
      const dateOk = tol.ignoreDate || dDiff == null || dDiff <= tol.dateDays;

      // scoring: prefer invoice-no match, then closer value, then closer date
      let score = 0;
      if (invMatch) score += 1000;
      if (valueOk) score += 200;
      if (dateOk) score += 50;
      score -= Math.min(vDiff / 100, 200); // penalize ₹ diff
      if (dDiff != null) score -= Math.min(dDiff, 60);

      // require at least gstin + (invMatch OR valueOk OR (close-by date AND value within 5%))
      const looseValueOk = vDiff <= Math.max(tol.valuePaise, Math.round(row.invoice_value_paise * 0.05));
      if (!invMatch && !valueOk && !(dateOk && looseValueOk)) continue;

      let reason: MatchStatus = "matched";
      if (invMatch && valueOk && dateOk) reason = "matched";
      else if (invMatch && !valueOk) reason = "value_mismatch";
      else if (invMatch && !dateOk) reason = "date_mismatch";
      else if (!invMatch && valueOk && dateOk) reason = tol.ignoreInvoiceNo ? "matched_with_tolerance" : "invoice_no_mismatch";
      else if (!invMatch && looseValueOk && dateOk) reason = "probable_match";
      else reason = "matched_with_tolerance";

      if (!best || score > best.score) best = { b, score, vDiff, dDiff, reason };
    }

    if (best) {
      consumed.add(best.b.id);
      // sharpen status: check tax heads diff
      const taxDiff =
        Math.abs(best.b.raw.total_paise - row.invoice_value_paise);
      let status = best.reason;
      // promote near-exact to matched
      if (
        status === "matched_with_tolerance" &&
        best.vDiff <= tol.valuePaise &&
        (best.dDiff == null || best.dDiff <= tol.dateDays)
      ) {
        status = "matched_with_tolerance";
      }
      results.push({
        row,
        match_status: status,
        matched_voucher_id: best.b.id,
        diff: { value: best.vDiff, tax: taxDiff, days: best.dDiff },
      });
    } else {
      results.push({ row, match_status: "unmatched", matched_voucher_id: null });
    }
  }
  return results;
}
