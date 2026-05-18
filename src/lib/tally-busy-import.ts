// Shared parsers and posters for the Tally / Busy importer.
// Used by both the per-type tabs and the "All-in-One" combined tab.

import { supabase } from "@/integrations/supabase/client";
import {
  guessGroupCode,
  defaultLedgerTypeForGroup,
} from "@/lib/account-groups";
import type { Database } from "@/integrations/supabase/types";

export type LedgerType = Database["public"]["Enums"]["ledger_type"];
export type VoucherType = Database["public"]["Enums"]["voucher_type"];

// ---------------- Saved ledger-name → group mappings ----------------

export interface LedgerMappingRow {
  source_name: string;
  source_name_lc: string;
  group_code: string;
  ledger_type: LedgerType;
}

/** Fetch all saved mappings for a company, indexed by lowercase source name. */
export async function fetchLedgerMappings(
  companyId: string,
): Promise<Map<string, LedgerMappingRow>> {
  const { data, error } = await supabase
    .from("ledger_group_mappings")
    .select("source_name, source_name_lc, group_code, ledger_type")
    .eq("company_id", companyId);
  if (error) throw error;
  const map = new Map<string, LedgerMappingRow>();
  for (const r of data || []) {
    map.set(r.source_name_lc, r as LedgerMappingRow);
  }
  return map;
}

/** Apply saved mappings to parsed ledger rows in-place (returns a new array). */
export function applyMappingsToLedgers(
  rows: LedgerRecord[],
  mappings: Map<string, LedgerMappingRow>,
): LedgerRecord[] {
  return rows.map((r) => {
    const m = mappings.get(lc(r.name));
    if (!m) return r;
    return { ...r, group_code: m.group_code, type: m.ledger_type };
  });
}

// ---------------- Fuzzy matching ----------------

/** Normalize a name for fuzzy comparison: lowercase, strip punctuation,
 *  collapse whitespace, drop common noise tokens. */
export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(a|an|the|and|of|m\/s|messrs|ltd|limited|pvt|private|llp|inc|co|company|corp|corporation|enterprises?|trader|traders|trading|industries|industry|services?|store|stores)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeName(s).split(" ").filter((t) => t.length > 1);
}

/** Damerau–Levenshtein distance, capped for performance. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const prev = new Array(bl + 1);
  const cur = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= bl; j++) prev[j] = cur[j];
  }
  return prev[bl];
}

/** Similarity in [0,1] combining edit distance + token overlap. */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Edit-distance ratio on the normalized strings.
  const d = editDistance(na, nb);
  const editScore = 1 - d / Math.max(na.length, nb.length);

  // Token Jaccard with substring credit (handles word reorder + abbreviations).
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return Math.max(0, editScore);
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) { inter++; continue; }
    // partial credit for prefix / contains (e.g. "hdfc" vs "hdfcbank")
    for (const u of tb) {
      if (t.length >= 3 && (u.startsWith(t) || t.startsWith(u) || u.includes(t) || t.includes(u))) {
        inter += 0.5; break;
      }
    }
  }
  const union = ta.size + tb.size - Math.min(ta.size, tb.size);
  const jaccard = inter / union;

  return Math.max(editScore, 0.6 * jaccard + 0.4 * editScore);
}

export interface FuzzySuggestion {
  index: number;            // index into the input ledgers array
  source: string;           // original ledger name being matched
  match: LedgerMappingRow;  // the saved mapping that was matched
  score: number;            // similarity score in [0,1]
}

/** Build fuzzy-match suggestions for ledger rows that have NO exact saved match. */
export function buildFuzzySuggestions(
  rows: LedgerRecord[],
  mappings: Map<string, LedgerMappingRow>,
  threshold = 0.78,
): FuzzySuggestion[] {
  if (mappings.size === 0) return [];
  const candidates = Array.from(mappings.values());
  const normCandidates = candidates.map((c) => ({
    cand: c,
    norm: normalizeName(c.source_name),
  }));
  const out: FuzzySuggestion[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (mappings.has(lc(r.name))) continue; // exact match already handled
    const nr = normalizeName(r.name);
    if (!nr) continue;
    let best: { cand: LedgerMappingRow; score: number } | null = null;
    for (const { cand, norm } of normCandidates) {
      // Cheap length filter to skip obvious mismatches
      if (Math.abs(norm.length - nr.length) > Math.max(nr.length, norm.length) * 0.6) continue;
      const s = similarity(r.name, cand.source_name);
      if (!best || s > best.score) best = { cand, score: s };
      if (best.score >= 0.99) break;
    }
    if (best && best.score >= threshold) {
      out.push({ index: i, source: r.name, match: best.cand, score: best.score });
    }
  }
  return out;
}

/** Apply a set of accepted fuzzy suggestions to ledger rows, returning a new array. */
export function applyFuzzySuggestions(
  rows: LedgerRecord[],
  accepted: FuzzySuggestion[],
): LedgerRecord[] {
  if (accepted.length === 0) return rows;
  const byIdx = new Map(accepted.map((s) => [s.index, s]));
  return rows.map((r, i) => {
    const s = byIdx.get(i);
    if (!s) return r;
    return { ...r, group_code: s.match.group_code, type: s.match.ledger_type };
  });
}

/** Persist (upsert) mappings for the given ledger rows. */
export async function saveLedgerMappings(
  companyId: string,
  rows: { name: string; group_code: string; type: LedgerType }[],
): Promise<{ saved: number }> {
  if (rows.length === 0) return { saved: 0 };
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id ?? null;
  // De-duplicate by lc name (last write wins)
  const seen = new Map<string, { name: string; group_code: string; type: LedgerType }>();
  for (const r of rows) {
    if (!r.name) continue;
    seen.set(lc(r.name), r);
  }
  const payload = Array.from(seen.entries()).map(([lcName, r]) => ({
    company_id: companyId,
    source_name: r.name,
    source_name_lc: lcName,
    group_code: r.group_code,
    ledger_type: r.type,
    created_by: userId,
  }));
  // Chunk to avoid huge requests
  let saved = 0;
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from("ledger_group_mappings")
      .upsert(slice, { onConflict: "company_id,source_name_lc" });
    if (error) throw error;
    saved += slice.length;
  }
  return { saved };
}

// ---------------- Generic helpers ----------------
export function lc(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}
export function num(s: unknown): number {
  if (typeof s === "number") return s;
  const v = String(s ?? "").replace(/[, ₹]/g, "").trim();
  if (!v) return 0;
  const cr = / cr$/i.test(v);
  const dr = / dr$/i.test(v);
  const cleaned = v.replace(/\s*(cr|dr)$/i, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return cr ? -Math.abs(n) : dr ? Math.abs(n) : n;
}
export function paise(rupees: number): number {
  return Math.round(rupees * 100);
}
export function pickField(row: Record<string, unknown>, candidates: string[]): string {
  for (const k of Object.keys(row)) {
    const lk = lc(k).replace(/[_\s.-]/g, "");
    for (const c of candidates) {
      if (lk === c.replace(/[_\s.-]/g, "").toLowerCase()) {
        return String(row[k] ?? "").trim();
      }
    }
  }
  for (const k of Object.keys(row)) {
    const lk = lc(k);
    for (const c of candidates) {
      if (lk.includes(lc(c))) return String(row[k] ?? "").trim();
    }
  }
  return "";
}

function readText(f: File | Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = () => rej(r.error);
    r.readAsText(f);
  });
}
function readBuffer(f: File | Blob): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(f);
  });
}

/**
 * Smart text decoder. Detects UTF-16 LE/BE, UTF-8 BOM, or NUL-heavy data
 * (common in Tally XML exports) and decodes accordingly. Strips BOM + stray NULs.
 */
export type EncodingChoice = "auto" | "utf-8" | "utf-16le" | "utf-16be";

export async function decodeFileSmart(
  f: File | Blob,
  forced: EncodingChoice = "auto",
  stripNuls = true,
): Promise<string> {
  const buf = await readBuffer(f);
  const bytes = new Uint8Array(buf);
  let encoding: "utf-16le" | "utf-16be" | "utf-8" = "utf-8";
  let sliceFrom = 0;
  if (forced !== "auto") {
    encoding = forced;
    if (encoding === "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe) sliceFrom = 2;
    else if (encoding === "utf-16be" && bytes[0] === 0xfe && bytes[1] === 0xff) sliceFrom = 2;
    else if (encoding === "utf-8" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) sliceFrom = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    sliceFrom = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    sliceFrom = 2;
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = "utf-8";
    sliceFrom = 3;
  } else {
    // Heuristic: lots of NULs at even indices → UTF-16LE; odd → UTF-16BE
    const sample = bytes.subarray(0, Math.min(2048, bytes.length));
    let nulEven = 0, nulOdd = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        if (i % 2 === 0) nulOdd++;
        else nulEven++;
      }
    }
    if (nulEven > sample.length * 0.2) encoding = "utf-16le";
    else if (nulOdd > sample.length * 0.2) encoding = "utf-16be";
  }
  const view = sliceFrom > 0 ? bytes.subarray(sliceFrom) : bytes;
  const decoded = new TextDecoder(encoding, { fatal: false }).decode(view);
  // Always strip leading BOM character; strip residual NULs only when requested.
  const noBom = decoded.replace(/^\uFEFF/, "");
  return stripNuls ? noBom.replace(/\u0000/g, "") : noBom;
}

/** Utility: yield to the browser so the UI can paint between heavy batches. */
export function yieldToUI(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

/** User-tweakable import settings (from the settings panel). */
export interface ImportSettings {
  encoding: EncodingChoice;
  stripNuls: boolean;
  chunkSize: number;
  previewLimit: number;
}

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  encoding: "auto",
  stripNuls: true,
  chunkSize: 2000,
  previewLimit: 200,
};


// ---------------- Parsing ----------------

/** Row record + originating sheet name (helps classify CSV/Excel). */
export interface ParsedRow extends Record<string, unknown> {
  __sheet?: string;
  __tally_kind?: "LEDGER" | "STOCKITEM" | "VOUCHER";
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = v
        .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
        .join(" | ");
    } else {
      out[key] = v;
    }
  }
  if (obj["@_NAME"]) out["NAME"] = String(obj["@_NAME"]);
  if (obj["@_VCHTYPE"]) out["VOUCHERTYPENAME"] = String(obj["@_VCHTYPE"]);
  if (obj["@_DATE"]) out["DATE"] = String(obj["@_DATE"]);
  return out;
}

/** Walk Tally XML and emit row records tagged with __tally_kind. */
export async function parseTallyXml(xml: string): Promise<ParsedRow[]> {
  const { XMLParser } = await import("fast-xml-parser");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
  });
  const tree = parser.parse(xml) as Record<string, unknown>;
  const rows: ParsedRow[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toUpperCase();
      if (key === "LEDGER" || key === "STOCKITEM" || key === "VOUCHER") {
        const arr = Array.isArray(v) ? v : [v];
        for (const item of arr) {
          if (item && typeof item === "object") {
            const flat = flattenObject(item as Record<string, unknown>) as ParsedRow;
            flat.__tally_kind = key;
            rows.push(flat);
          }
        }
      } else {
        walk(v);
      }
    }
  }
  walk(tree);
  return rows;
}

/** Parse any single (non-zip) file into row records. */
export async function parseAnyFile(
  f: File | Blob,
  name: string,
  settings: ImportSettings = DEFAULT_IMPORT_SETTINGS,
): Promise<ParsedRow[]> {
  const lname = name.toLowerCase();
  if (lname.endsWith(".xml")) {
    const text = await decodeFileSmart(f, settings.encoding, settings.stripNuls);
    return await parseTallyXml(text);
  }
  if (lname.endsWith(".csv") || lname.endsWith(".txt")) {
    const text = await decodeFileSmart(f, settings.encoding, settings.stripNuls);
    const Papa = (await import("papaparse")).default;
    const out = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    return (out.data || [])
      .filter((r) => r && Object.keys(r).length > 0)
      .map((r) => ({ ...r, __sheet: lname.replace(/\.[^.]+$/, "") }));
  }
  // Excel
  const buf = await readBuffer(f);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const rows: ParsedRow[] = [];
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    // Detect the header row by scanning the first ~30 rows for one that
    // contains several known column keywords. Many ERP exports (Marg, Busy,
    // Tally print reports) prefix the data with banner / title rows.
    const HEADER_TOKENS = [
      "date", "dt", "bill no", "bill no.", "voucher", "vch", "vchno",
      "party", "ledger", "account", "name", "amount", "amt", "bill amt",
      "taxable", "tax", "hsn", "qty", "rate", "debit", "credit", "narration",
      "particulars", "gstin", "opening", "group", "under",
    ];
    let headerIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const cells = (aoa[i] || []).map((c) => lc(c));
      let score = 0;
      for (const c of cells) {
        if (!c) continue;
        for (const t of HEADER_TOKENS) if (c === t || c.includes(t)) { score++; break; }
      }
      if (score >= 3 && score > bestScore) { bestScore = score; headerIdx = i; }
    }
    // Banner text above the header — useful as a voucher-type hint
    // ("PURCHASE BOOK", "SALES REGISTER", etc).
    let reportTitle = "";
    if (headerIdx > 0) {
      reportTitle = aoa.slice(0, headerIdx)
        .map((r) => (r || []).map((c) => String(c ?? "").trim()).join(" "))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (headerIdx === -1) {
      // Fall back to the original behavior: treat row 0 as the header.
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "", raw: false,
      });
      for (const r of json) rows.push({ ...r, __sheet: sheet, __report_title: reportTitle });
    } else {
      const header = (aoa[headerIdx] || []).map((c, i) => {
        const s = String(c ?? "").trim();
        return s || `col_${i + 1}`;
      });
      for (let i = headerIdx + 1; i < aoa.length; i++) {
        const row = aoa[i] || [];
        // Skip rows that look like dashed separators / blank lines.
        const nonEmpty = row.filter((c) => String(c ?? "").trim() !== "");
        if (nonEmpty.length === 0) continue;
        const joined = nonEmpty.map((c) => String(c)).join("");
        if (/^[-=_*\s]+$/.test(joined)) continue;
        const obj: Record<string, unknown> = {};
        for (let j = 0; j < header.length; j++) obj[header[j]] = row[j] ?? "";
        obj.__sheet = sheet;
        obj.__report_title = reportTitle;
        rows.push(obj);
      }
    }
  }
  return rows;
}

/** Top-level entry: handles ZIP archives by recursing into each inner file. */
export async function parseFileOrZip(
  f: File,
  settings: ImportSettings = DEFAULT_IMPORT_SETTINGS,
): Promise<ParsedRow[]> {
  const lname = f.name.toLowerCase();
  if (lname.endsWith(".zip")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(f);
    const all: ParsedRow[] = [];
    for (const fname of Object.keys(zip.files)) {
      const entry = zip.files[fname];
      if (entry.dir) continue;
      const lower = fname.toLowerCase();
      if (!/\.(xml|csv|txt|xlsx|xls)$/.test(lower)) continue;
      const blob = await entry.async("blob");
      const inner = await parseAnyFile(blob, fname, settings);
      for (const r of inner) {
        if (!r.__sheet) r.__sheet = fname;
        all.push(r);
      }
    }
    return all;
  }
  return parseAnyFile(f, f.name, settings);
}

// ---------------- Classification ----------------

export type RowKind = "ledger" | "item" | "voucher" | "unknown";

/** Decide whether a row is a Ledger / Stock Item / Voucher. */
export function classifyRow(r: ParsedRow): RowKind {
  if (r.__tally_kind === "LEDGER") return "ledger";
  if (r.__tally_kind === "STOCKITEM") return "item";
  if (r.__tally_kind === "VOUCHER") return "voucher";

  const sheet = lc(r.__sheet || "");
  if (sheet.includes("ledger") || sheet.includes("account")) return "ledger";
  if (sheet.includes("item") || sheet.includes("stock") || sheet.includes("inventory")) return "item";
  if (sheet.includes("daybook") || sheet.includes("day book") || sheet.includes("voucher") || sheet.includes("transaction")) return "voucher";

  // Column fingerprint
  const keys = Object.keys(r).map((k) => lc(k));
  const has = (s: string) => keys.some((k) => k.includes(s));

  const voucherSig = (has("voucher") || has("vch")) && (has("date") || has("dt")) && (has("amount") || has("total"));
  if (voucherSig) return "voucher";

  const itemSig = (has("hsn") || has("sac")) || has("uom") || has("unit") || has("stock");
  const ledgerSig = has("opening") || has("group") || has("under") || has("gstin");

  if (itemSig && !ledgerSig) return "item";
  if (ledgerSig) return "ledger";

  if (has("name") || has("party")) return "ledger";
  return "unknown";
}

// ---------------- Mappers (raw row → typed record) ----------------

export interface LedgerRecord {
  name: string;
  type: LedgerType;
  group_code: string;
  gstin: string;
  state: string;
  email: string;
  phone: string;
  opening: number; // signed rupees
}

export function mapLedger(r: ParsedRow): LedgerRecord | null {
  const name = pickField(r, ["NAME", "Ledger Name", "Account Name", "Party Name", "Name"]);
  if (!name) return null;
  const groupName = pickField(r, ["PARENT", "Group", "Under Group", "Group Name"]);
  const opening = num(pickField(r, ["OPENINGBALANCE", "Opening Balance", "Opening Bal", "Op Bal"]));
  const isCr = / cr$/i.test(pickField(r, ["OPENINGBALANCE", "Opening Balance"]));
  const signed = isCr ? -Math.abs(opening) : opening;
  const sideHint: "Dr" | "Cr" = signed >= 0 ? "Dr" : "Cr";
  const groupCode = guessGroupCode(groupName || name, sideHint);
  const type = (defaultLedgerTypeForGroup(groupCode) ?? "current_asset") as LedgerType;
  return {
    name,
    type,
    group_code: groupCode,
    gstin: pickField(r, ["GSTIN", "GST IN", "GSTNo", "GST Number"]),
    state: pickField(r, ["STATE", "State"]),
    email: pickField(r, ["EMAIL", "Email"]),
    phone: pickField(r, ["PHONE", "Mobile", "Contact", "Phone"]),
    opening: signed,
  };
}

export interface ItemRecord {
  name: string;
  hsn: string;
  unit: string;
  gst_rate: number;
  opening_qty: number;
  opening_rate: number;
  sale_price: number;
  purchase_price: number;
}

export function mapItem(r: ParsedRow): ItemRecord | null {
  const name = pickField(r, ["NAME", "Item Name", "Stock Item", "Product"]);
  if (!name) return null;
  return {
    name,
    hsn: pickField(r, ["HSNCODE", "HSN", "HSN Code", "HSN/SAC"]),
    unit: pickField(r, ["BASEUNITS", "Unit", "UOM", "Units"]) || "NOS",
    gst_rate: num(pickField(r, ["GSTRATE", "GST Rate", "Tax Rate", "GST %"])),
    opening_qty: num(pickField(r, ["OPENINGBALANCE", "Opening Qty", "Opening Stock"])),
    opening_rate: num(pickField(r, ["OPENINGRATE", "Opening Rate", "Rate"])),
    sale_price: num(pickField(r, ["SALESPRICE", "Sale Price", "Selling Price", "MRP"])),
    purchase_price: num(pickField(r, ["PURCHASEPRICE", "Purchase Price", "Cost"])),
  };
}

export interface VoucherRecord {
  date: string;
  voucher_no: string;
  vtype: VoucherType;
  party: string;
  narration: string;
  total: number;
}

export function normalizeDate(s: string): string {
  if (!s) return "";
  const t = s.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function detectVoucherType(s: string): VoucherType {
  const x = lc(s);
  if (x.includes("sale")) return "sales";
  if (x.includes("purch")) return "purchase";
  if (x.includes("receipt")) return "receipt";
  if (x.includes("payment")) return "payment";
  if (x.includes("contra")) return "contra";
  if (x.includes("credit")) return "credit_note";
  if (x.includes("debit")) return "debit_note";
  return "journal";
}

export function mapVoucher(r: ParsedRow): VoucherRecord | null {
  const date = normalizeDate(pickField(r, ["DATE", "Voucher Date", "Date", "Dt"]));
  const vno = pickField(r, ["VOUCHERNUMBER", "Voucher Number", "Voucher No", "Vch No", "Bill No"]);
  const vtype = detectVoucherType(pickField(r, ["VOUCHERTYPENAME", "Voucher Type", "Type"]));
  const party = pickField(r, ["PARTYLEDGERNAME", "PARTYNAME", "Party", "Party Name", "Account", "Ledger"]);
  const total = num(pickField(r, ["AMOUNT", "Amount", "Total", "Grand Total", "Bill Amount", "Net Amount"]));
  if (!date || !vno) return null;
  return {
    date,
    voucher_no: vno,
    vtype,
    party,
    narration: pickField(r, ["NARRATION", "Narration", "Description", "Particulars"]),
    total: Math.abs(total),
  };
}

// ---------------- Posters ----------------

export interface PostResult { created: number; updated: number; skipped: number }

export interface PostResultEx extends PostResult {
  failed: { name: string; reason: string }[];
}

export type ProgressCb = (done: number, total: number, label?: string) => void;

/** Estimated parse-time band (used by the UI to warn about big files). */
export function estimateBand(sizeBytes: number): {
  band: "tiny" | "small" | "medium" | "large" | "huge";
  label: string;
  warn: boolean;
} {
  const mb = sizeBytes / (1024 * 1024);
  if (mb < 2) return { band: "tiny", label: "A few seconds", warn: false };
  if (mb < 10) return { band: "small", label: "5–30 seconds", warn: false };
  if (mb < 50) return { band: "medium", label: "30 seconds to 2 minutes — keep this tab open", warn: true };
  if (mb < 200) return { band: "large", label: "2–5 minutes — keep this tab open and your laptop plugged in", warn: true };
  return { band: "huge", label: "Several minutes — large files may stress the browser", warn: true };
}

export interface ClassifiedBatch {
  ledgers: LedgerRecord[];
  items: ItemRecord[];
  vouchers: VoucherRecord[];
  unknown: number;
}

/** Classify + map rows in chunks, yielding to the UI between batches. */
export async function classifyAndMap(
  rows: ParsedRow[],
  onProgress?: ProgressCb,
  chunkSize = 2000,
): Promise<ClassifiedBatch> {
  const out: ClassifiedBatch = { ledgers: [], items: [], vouchers: [], unknown: 0 };
  for (let i = 0; i < rows.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, rows.length);
    for (let j = i; j < end; j++) {
      const row = rows[j];
      const kind = classifyRow(row);
      if (kind === "ledger") {
        const x = mapLedger(row); if (x) out.ledgers.push(x); else out.unknown++;
      } else if (kind === "item") {
        const x = mapItem(row); if (x) out.items.push(x); else out.unknown++;
      } else if (kind === "voucher") {
        const x = mapVoucher(row); if (x) out.vouchers.push(x); else out.unknown++;
      } else { out.unknown++; }
    }
    onProgress?.(end, rows.length, "Classifying records");
    await yieldToUI();
  }
  return out;
}

export async function postLedgers(
  companyId: string,
  rows: LedgerRecord[],
  onProgress?: ProgressCb,
): Promise<PostResultEx> {
  const { data: existing } = await supabase
    .from("ledgers").select("id, name").eq("company_id", companyId);
  const map = new Map<string, string>(
    (existing || []).map((l) => [lc(l.name), l.id]),
  );
  let created = 0, updated = 0, skipped = 0;
  const failed: { name: string; reason: string }[] = [];
  let done = 0;
  for (const r of rows) {
    if (!r.name) { skipped++; continue; }
    const payload = {
      company_id: companyId,
      name: r.name,
      type: r.type,
      group_code: r.group_code,
      gstin: r.gstin || null,
      state: r.state || null,
      email: r.email || null,
      phone: r.phone || null,
      opening_balance_paise: Math.abs(paise(r.opening)),
      opening_balance_is_debit: r.opening >= 0,
    };
    const id = map.get(lc(r.name));
    if (id) {
      const { error } = await supabase.from("ledgers").update(payload).eq("id", id);
      if (error) { skipped++; failed.push({ name: r.name, reason: error.message }); } else updated++;
    } else {
      const { data, error } = await supabase
        .from("ledgers").insert(payload).select("id").single();
      if (error || !data) {
        skipped++;
        failed.push({ name: r.name, reason: error?.message || "insert failed" });
      } else { created++; map.set(lc(r.name), data.id); }
    }
    done++;
    if (done % 25 === 0) {
      onProgress?.(done, rows.length, "Posting ledgers");
      await yieldToUI();
    }
  }
  onProgress?.(rows.length, rows.length, "Posting ledgers");
  return { created, updated, skipped, failed };
}

export async function postItems(
  companyId: string,
  rows: ItemRecord[],
  onProgress?: ProgressCb,
): Promise<PostResultEx> {
  const { data: existing } = await supabase
    .from("items").select("id, name").eq("company_id", companyId);
  const map = new Map<string, string>((existing || []).map((x) => [lc(x.name), x.id]));
  let created = 0, updated = 0, skipped = 0;
  const failed: { name: string; reason: string }[] = [];
  let done = 0;
  for (const r of rows) {
    if (!r.name) { skipped++; continue; }
    const payload = {
      company_id: companyId,
      name: r.name,
      hsn_code: r.hsn || null,
      unit: r.unit || "NOS",
      gst_rate: r.gst_rate || 0,
      opening_stock_qty: r.opening_qty || 0,
      opening_stock_rate_paise: paise(r.opening_rate),
      sale_price_paise: paise(r.sale_price),
      purchase_price_paise: paise(r.purchase_price),
    };
    const id = map.get(lc(r.name));
    if (id) {
      const { error } = await supabase.from("items").update(payload).eq("id", id);
      if (error) { skipped++; failed.push({ name: r.name, reason: error.message }); } else updated++;
    } else {
      const { error } = await supabase.from("items").insert(payload);
      if (error) { skipped++; failed.push({ name: r.name, reason: error.message }); } else created++;
    }
    done++;
    if (done % 25 === 0) {
      onProgress?.(done, rows.length, "Posting items");
      await yieldToUI();
    }
  }
  onProgress?.(rows.length, rows.length, "Posting items");
  return { created, updated, skipped, failed };
}

export async function postVouchers(
  companyId: string,
  rows: VoucherRecord[],
  onProgress?: ProgressCb,
): Promise<PostResultEx> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { data: ledgers } = await supabase
    .from("ledgers").select("id, name, type").eq("company_id", companyId);
  const ledgerMap = new Map<string, { id: string; type: string }>(
    (ledgers || []).map((l) => [lc(l.name), { id: l.id, type: l.type }]),
  );
  async function ensureLedger(name: string, type: LedgerType): Promise<string> {
    const k = lc(name);
    const hit = ledgerMap.get(k);
    if (hit) return hit.id;
    const { data, error } = await supabase
      .from("ledgers").insert({ company_id: companyId, name, type }).select("id").single();
    if (error) throw error;
    ledgerMap.set(k, { id: data.id, type });
    return data.id;
  }

  let created = 0, skipped = 0;
  const failed: { name: string; reason: string }[] = [];
  let done = 0;
  for (const r of rows) {
    try {
    let partyId: string | null = null;
    if (r.party) {
      const inferredType: LedgerType = (
        r.vtype === "sales" || r.vtype === "receipt" || r.vtype === "credit_note"
          ? "sundry_debtor"
          : r.vtype === "purchase" || r.vtype === "payment" || r.vtype === "debit_note"
          ? "sundry_creditor"
          : "current_asset"
      ) as LedgerType;
      partyId = await ensureLedger(r.party, inferredType);
    }
    let counterId: string;
    if (r.vtype === "sales") counterId = await ensureLedger("Sales A/c", "income_direct");
    else if (r.vtype === "purchase") counterId = await ensureLedger("Purchase A/c", "expense_direct");
    else if (r.vtype === "credit_note") counterId = await ensureLedger("Sales Return A/c", "income_direct");
    else if (r.vtype === "debit_note") counterId = await ensureLedger("Purchase Return A/c", "expense_direct");
    else if (r.vtype === "receipt") counterId = await ensureLedger("Cash A/c", "cash");
    else if (r.vtype === "payment") counterId = await ensureLedger("Cash A/c", "cash");
    else { skipped++; continue; }

    if (!partyId) { skipped++; continue; }

    const totalP = paise(r.total);
    const { data: vch, error: vErr } = await supabase
      .from("vouchers").insert({
        company_id: companyId,
        voucher_type: r.vtype,
        voucher_number: r.voucher_no,
        voucher_date: r.date,
        party_ledger_id: partyId,
        narration: r.narration || null,
        subtotal_paise: totalP,
        total_paise: totalP,
        created_by: user.id,
      }).select("id").single();
    if (vErr || !vch) {
      skipped++;
      failed.push({ name: `${r.voucher_no} (${r.date})`, reason: vErr?.message || "insert failed" });
      continue;
    }

    const entries: { ledger_id: string; debit_paise: number; credit_paise: number; line_no: number; voucher_id: string }[] = [];
    if (r.vtype === "sales" || r.vtype === "debit_note") {
      entries.push({ voucher_id: vch.id, ledger_id: partyId, debit_paise: totalP, credit_paise: 0, line_no: 1 });
      entries.push({ voucher_id: vch.id, ledger_id: counterId, debit_paise: 0, credit_paise: totalP, line_no: 2 });
    } else if (r.vtype === "purchase" || r.vtype === "credit_note") {
      entries.push({ voucher_id: vch.id, ledger_id: counterId, debit_paise: totalP, credit_paise: 0, line_no: 1 });
      entries.push({ voucher_id: vch.id, ledger_id: partyId, debit_paise: 0, credit_paise: totalP, line_no: 2 });
    } else if (r.vtype === "receipt") {
      entries.push({ voucher_id: vch.id, ledger_id: counterId, debit_paise: totalP, credit_paise: 0, line_no: 1 });
      entries.push({ voucher_id: vch.id, ledger_id: partyId, debit_paise: 0, credit_paise: totalP, line_no: 2 });
    } else if (r.vtype === "payment") {
      entries.push({ voucher_id: vch.id, ledger_id: partyId, debit_paise: totalP, credit_paise: 0, line_no: 1 });
      entries.push({ voucher_id: vch.id, ledger_id: counterId, debit_paise: 0, credit_paise: totalP, line_no: 2 });
    }
    if (entries.length > 0) await supabase.from("voucher_entries").insert(entries);
    created++;
    } catch (err) {
      const e = err as { message?: string };
      skipped++;
      failed.push({ name: `${r.voucher_no} (${r.date})`, reason: e.message || "unknown" });
    }
    done++;
    if (done % 10 === 0) {
      onProgress?.(done, rows.length, "Posting vouchers");
      await yieldToUI();
    }
  }
  onProgress?.(rows.length, rows.length, "Posting vouchers");
  return { created, updated: 0, skipped, failed };
}