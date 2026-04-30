// Shared parsers and posters for the Tally / Busy importer.
// Used by both the per-type tabs and the "All-in-One" combined tab.

import { supabase } from "@/integrations/supabase/client";
import { XMLParser } from "fast-xml-parser";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import JSZip from "jszip";
import {
  guessGroupCode,
  defaultLedgerTypeForGroup,
} from "@/lib/account-groups";
import type { Database } from "@/integrations/supabase/types";

export type LedgerType = Database["public"]["Enums"]["ledger_type"];
export type VoucherType = Database["public"]["Enums"]["voucher_type"];

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
export function parseTallyXml(xml: string): ParsedRow[] {
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
export async function parseAnyFile(f: File | Blob, name: string): Promise<ParsedRow[]> {
  const lname = name.toLowerCase();
  if (lname.endsWith(".xml")) {
    const text = await readText(f);
    return parseTallyXml(text);
  }
  if (lname.endsWith(".csv") || lname.endsWith(".txt")) {
    const text = await readText(f);
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
  const wb = XLSX.read(buf, { type: "array" });
  const rows: ParsedRow[] = [];
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: false,
    });
    for (const r of json) rows.push({ ...r, __sheet: sheet });
  }
  return rows;
}

/** Top-level entry: handles ZIP archives by recursing into each inner file. */
export async function parseFileOrZip(f: File): Promise<ParsedRow[]> {
  const lname = f.name.toLowerCase();
  if (lname.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(f);
    const all: ParsedRow[] = [];
    for (const fname of Object.keys(zip.files)) {
      const entry = zip.files[fname];
      if (entry.dir) continue;
      const lower = fname.toLowerCase();
      if (!/\.(xml|csv|txt|xlsx|xls)$/.test(lower)) continue;
      const blob = await entry.async("blob");
      const inner = await parseAnyFile(blob, fname);
      for (const r of inner) {
        if (!r.__sheet) r.__sheet = fname;
        all.push(r);
      }
    }
    return all;
  }
  return parseAnyFile(f, f.name);
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

export async function postLedgers(
  companyId: string,
  rows: LedgerRecord[],
): Promise<PostResult> {
  const { data: existing } = await supabase
    .from("ledgers").select("id, name").eq("company_id", companyId);
  const map = new Map<string, string>(
    (existing || []).map((l) => [lc(l.name), l.id]),
  );
  let created = 0, updated = 0, skipped = 0;
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
      if (error) skipped++; else updated++;
    } else {
      const { data, error } = await supabase
        .from("ledgers").insert(payload).select("id").single();
      if (error || !data) { skipped++; }
      else { created++; map.set(lc(r.name), data.id); }
    }
  }
  return { created, updated, skipped };
}

export async function postItems(
  companyId: string,
  rows: ItemRecord[],
): Promise<PostResult> {
  const { data: existing } = await supabase
    .from("items").select("id, name").eq("company_id", companyId);
  const map = new Map<string, string>((existing || []).map((x) => [lc(x.name), x.id]));
  let created = 0, updated = 0, skipped = 0;
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
      if (error) skipped++; else updated++;
    } else {
      const { error } = await supabase.from("items").insert(payload);
      if (error) skipped++; else created++;
    }
  }
  return { created, updated, skipped };
}

export async function postVouchers(
  companyId: string,
  rows: VoucherRecord[],
): Promise<PostResult> {
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
  for (const r of rows) {
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
    if (vErr || !vch) { skipped++; continue; }

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
  }
  return { created, updated: 0, skipped };
}