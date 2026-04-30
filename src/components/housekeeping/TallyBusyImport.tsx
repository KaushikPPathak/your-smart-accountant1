// Import masters (Ledgers, Items) and Vouchers from Tally / Busy / generic
// CSV / Excel / XML exports. Designed to be tolerant of column-naming
// differences across accounting packages.
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, Database as DbIcon, Boxes, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { XMLParser } from "fast-xml-parser";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { guessGroupCode, defaultLedgerTypeForGroup, GROUP_BY_CODE } from "@/lib/account-groups";
import type { Database } from "@/integrations/supabase/types";

type LedgerType = Database["public"]["Enums"]["ledger_type"];
type VoucherType = Database["public"]["Enums"]["voucher_type"];

interface Props { companyId: string; disabled: boolean }

// ---------- Generic helpers ----------
function lc(s: unknown): string { return String(s ?? "").trim().toLowerCase(); }
function num(s: unknown): number {
  if (typeof s === "number") return s;
  const v = String(s ?? "").replace(/[, ₹]/g, "").trim();
  if (!v) return 0;
  // Tally exports negative as "(123.00)" or with " Cr"/" Dr" suffix
  const cr = / cr$/i.test(v);
  const dr = / dr$/i.test(v);
  const cleaned = v.replace(/\s*(cr|dr)$/i, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return cr ? -Math.abs(n) : dr ? Math.abs(n) : n;
}
function paise(rupees: number): number { return Math.round(rupees * 100); }

function pickField(row: Record<string, unknown>, candidates: string[]): string {
  for (const k of Object.keys(row)) {
    const lk = lc(k).replace(/[_\s.-]/g, "");
    for (const c of candidates) {
      if (lk === c.replace(/[_\s.-]/g, "").toLowerCase()) return String(row[k] ?? "").trim();
    }
  }
  // partial match
  for (const k of Object.keys(row)) {
    const lk = lc(k);
    for (const c of candidates) {
      if (lk.includes(lc(c))) return String(row[k] ?? "").trim();
    }
  }
  return "";
}

async function readFileAsText(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = () => rej(r.error);
    r.readAsText(f);
  });
}
async function readFileAsArrayBuffer(f: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(f);
  });
}

async function parseAnyFile(f: File): Promise<Record<string, unknown>[]> {
  const name = f.name.toLowerCase();
  if (name.endsWith(".xml")) {
    const text = await readFileAsText(f);
    return parseTallyXml(text);
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await readFileAsText(f);
    const out = Papa.parse<Record<string, unknown>>(text, {
      header: true, skipEmptyLines: true, dynamicTyping: false,
    });
    return (out.data || []).filter((r) => r && Object.keys(r).length > 0);
  }
  // Excel
  const buf = await readFileAsArrayBuffer(f);
  const wb = XLSX.read(buf, { type: "array" });
  const rows: Record<string, unknown>[] = [];
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    rows.push(...json);
  }
  return rows;
}

/** Flatten Tally XML (Masters export or Daybook) into row-shaped records. */
function parseTallyXml(xml: string): Record<string, unknown>[] {
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@_",
    parseTagValue: false, trimValues: true,
  });
  const tree = parser.parse(xml) as Record<string, unknown>;
  const rows: Record<string, unknown>[] = [];
  // Walk and collect all <LEDGER>, <STOCKITEM>, <VOUCHER> nodes
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toUpperCase();
      if (["LEDGER", "STOCKITEM", "VOUCHER"].includes(key)) {
        const arr = Array.isArray(v) ? v : [v];
        for (const item of arr) {
          if (item && typeof item === "object") {
            const flat = flattenObject(item as Record<string, unknown>);
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

function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" | ");
    } else {
      out[key] = v;
    }
  }
  // Tally puts ledger name in attribute @_NAME
  if (obj["@_NAME"]) out["NAME"] = String(obj["@_NAME"]);
  return out;
}

// ============================================================================
// Component
// ============================================================================
export function TallyBusyImport({ companyId, disabled }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DbIcon className="h-4 w-4" /> Import from Tally / Busy / other software
        </CardTitle>
        <CardDescription>
          Upload Tally XML exports (Masters / Daybook) or CSV / Excel exports from Busy or any other
          accounting package. The importer auto-detects column names and lets you preview each row
          before posting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ledgers">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ledgers"><DbIcon className="mr-1 h-3.5 w-3.5" /> Ledgers</TabsTrigger>
            <TabsTrigger value="items"><Boxes className="mr-1 h-3.5 w-3.5" /> Items</TabsTrigger>
            <TabsTrigger value="vouchers"><Receipt className="mr-1 h-3.5 w-3.5" /> Vouchers</TabsTrigger>
          </TabsList>
          <TabsContent value="ledgers" className="pt-4">
            <LedgerImporter companyId={companyId} disabled={disabled} />
          </TabsContent>
          <TabsContent value="items" className="pt-4">
            <ItemImporter companyId={companyId} disabled={disabled} />
          </TabsContent>
          <TabsContent value="vouchers" className="pt-4">
            <VoucherImporter companyId={companyId} disabled={disabled} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ---------- Ledger importer ----------
interface LedgerRow {
  _key: string;
  _selected: boolean;
  name: string;
  type: LedgerType;
  group_code: string;
  gstin: string;
  state: string;
  email: string;
  phone: string;
  opening: number;       // signed rupees (+ Dr / - Cr)
}

function LedgerImporter({ companyId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [posting, setPosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await parseAnyFile(f);
      const mapped: LedgerRow[] = data
        .map((r, i) => {
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
            _key: `r${i}`, _selected: true, name,
            type, group_code: groupCode,
            gstin: pickField(r, ["GSTIN", "GST IN", "GSTNo", "GST Number"]),
            state: pickField(r, ["STATE", "State"]),
            email: pickField(r, ["EMAIL", "Email"]),
            phone: pickField(r, ["PHONE", "Mobile", "Contact", "Phone"]),
            opening: signed,
          } as LedgerRow;
        })
        .filter((x): x is LedgerRow => x !== null);
      setRows(mapped);
      toast.success(`Parsed ${mapped.length} ledger rows`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Failed to parse file: ${e.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function postLedgers() {
    const sel = rows.filter((r) => r._selected && r.name);
    if (sel.length === 0) { toast.error("No rows selected"); return; }
    setPosting(true);
    try {
      const { data: existing } = await supabase
        .from("ledgers").select("id, name").eq("company_id", companyId);
      const existingMap = new Map<string, string>(
        (existing || []).map((l) => [lc(l.name), l.id]),
      );
      let created = 0, updated = 0;
      for (const r of sel) {
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
        const id = existingMap.get(lc(r.name));
        if (id) {
          const { error } = await supabase.from("ledgers").update(payload).eq("id", id);
          if (!error) updated++;
        } else {
          const { error } = await supabase.from("ledgers").insert(payload);
          if (!error) created++;
        }
      }
      toast.success(`Ledgers imported — ${created} created, ${updated} updated`);
      setRows([]);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally {
      setPosting(false);
    }
  }

  const selected = rows.filter((r) => r._selected).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow space-y-1">
          <Label>Tally XML, CSV, or Excel file</Label>
          <Input
            ref={fileInput} type="file" accept=".xml,.csv,.txt,.xlsx,.xls"
            disabled={disabled || busy}
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          <p className="text-[11px] text-muted-foreground">
            Tally: Gateway → Display → List of Accounts → Export (XML). Busy: Display → Account Books → Ledgers → Export (Excel/CSV).
          </p>
        </div>
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {selected} of {rows.length} selected
            </div>
            <Button onClick={postLedgers} disabled={posting || disabled || selected === 0}>
              {posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import {selected}</>}
            </Button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => (
                  <TableRow key={r._key}>
                    <TableCell>
                      <input
                        type="checkbox" checked={r._selected}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRows((rs) => rs.map((x, i) => i === idx ? { ...x, _selected: v } : x));
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {GROUP_BY_CODE[r.group_code]?.label || r.group_code}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{r.type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.gstin}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.opening !== 0 ? `${Math.abs(r.opening).toFixed(2)} ${r.opening >= 0 ? "Dr" : "Cr"}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Item importer ----------
interface ItemRow {
  _key: string;
  _selected: boolean;
  name: string;
  hsn: string;
  unit: string;
  gst_rate: number;
  opening_qty: number;
  opening_rate: number;  // rupees
  sale_price: number;
  purchase_price: number;
}

function ItemImporter({ companyId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [rows, setRows] = useState<ItemRow[]>([]);

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await parseAnyFile(f);
      const mapped: ItemRow[] = data
        .map((r, i) => {
          const name = pickField(r, ["NAME", "Item Name", "Stock Item", "Product"]);
          if (!name) return null;
          return {
            _key: `i${i}`, _selected: true, name,
            hsn: pickField(r, ["HSNCODE", "HSN", "HSN Code", "HSN/SAC"]),
            unit: pickField(r, ["BASEUNITS", "Unit", "UOM", "Units"]) || "NOS",
            gst_rate: num(pickField(r, ["GSTRATE", "GST Rate", "Tax Rate", "GST %"])),
            opening_qty: num(pickField(r, ["OPENINGBALANCE", "Opening Qty", "Opening Stock"])),
            opening_rate: num(pickField(r, ["OPENINGRATE", "Opening Rate", "Rate"])),
            sale_price: num(pickField(r, ["SALESPRICE", "Sale Price", "Selling Price", "MRP"])),
            purchase_price: num(pickField(r, ["PURCHASEPRICE", "Purchase Price", "Cost"])),
          } as ItemRow;
        })
        .filter((x): x is ItemRow => x !== null);
      setRows(mapped);
      toast.success(`Parsed ${mapped.length} item rows`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Failed to parse: ${e.message || "unknown"}`);
    } finally { setBusy(false); }
  }

  async function postItems() {
    const sel = rows.filter((r) => r._selected && r.name);
    if (sel.length === 0) { toast.error("No rows selected"); return; }
    setPosting(true);
    try {
      const { data: existing } = await supabase
        .from("items").select("id, name").eq("company_id", companyId);
      const map = new Map<string, string>((existing || []).map((x) => [lc(x.name), x.id]));
      let created = 0, updated = 0;
      for (const r of sel) {
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
          if (!error) updated++;
        } else {
          const { error } = await supabase.from("items").insert(payload);
          if (!error) created++;
        }
      }
      toast.success(`Items imported — ${created} created, ${updated} updated`);
      setRows([]);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally { setPosting(false); }
  }

  const selected = rows.filter((r) => r._selected).length;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Tally XML, CSV, or Excel file</Label>
        <Input type="file" accept=".xml,.csv,.txt,.xlsx,.xls" disabled={disabled || busy}
          onChange={(e) => onFile(e.target.files?.[0] || null)} />
        <p className="text-[11px] text-muted-foreground">
          Tally: Gateway → Display → Inventory Books → Stock Items → Export (XML). Busy: Display → Inventory → Items → Export.
        </p>
      </div>
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{selected} of {rows.length} selected</div>
            <Button onClick={postItems} disabled={posting || disabled || selected === 0}>
              {posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import {selected}</>}
            </Button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Op. Qty</TableHead>
                  <TableHead className="text-right">Op. Rate</TableHead>
                  <TableHead className="text-right">Sale ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => (
                  <TableRow key={r._key}>
                    <TableCell>
                      <input type="checkbox" checked={r._selected}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRows((rs) => rs.map((x, i) => i === idx ? { ...x, _selected: v } : x));
                        }} />
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.hsn}</TableCell>
                    <TableCell className="text-xs">{r.unit}</TableCell>
                    <TableCell className="text-right text-xs">{r.gst_rate}</TableCell>
                    <TableCell className="text-right text-xs">{r.opening_qty}</TableCell>
                    <TableCell className="text-right text-xs">{r.opening_rate.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{r.sale_price.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Voucher importer (sales / purchase / receipt / payment / journal) ----------
interface VoucherRowParsed {
  _key: string;
  _selected: boolean;
  date: string;          // YYYY-MM-DD
  voucher_no: string;
  vtype: VoucherType;
  party: string;
  narration: string;
  total: number;         // rupees
}

function normalizeDate(s: string): string {
  if (!s) return "";
  const t = s.trim();
  // 20240415 -> 2024-04-15
  if (/^\d{8}$/.test(t)) return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
  // dd/mm/yyyy or dd-mm-yyyy
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function detectVoucherType(s: string): VoucherType {
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

function VoucherImporter({ companyId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [rows, setRows] = useState<VoucherRowParsed[]>([]);

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await parseAnyFile(f);
      const mapped: VoucherRowParsed[] = data
        .map((r, i) => {
          const date = normalizeDate(pickField(r, ["DATE", "Voucher Date", "Date", "Dt"]));
          const vno = pickField(r, ["VOUCHERNUMBER", "Voucher Number", "Voucher No", "Vch No", "Bill No"]);
          const vtype = detectVoucherType(pickField(r, ["VOUCHERTYPENAME", "Voucher Type", "Type"]));
          const party = pickField(r, ["PARTYLEDGERNAME", "PARTYNAME", "Party", "Party Name", "Account", "Ledger"]);
          const total = num(pickField(r, ["AMOUNT", "Amount", "Total", "Grand Total", "Bill Amount", "Net Amount"]));
          if (!date || !vno) return null;
          return {
            _key: `v${i}`, _selected: true, date, voucher_no: vno, vtype, party,
            narration: pickField(r, ["NARRATION", "Narration", "Description", "Particulars"]),
            total: Math.abs(total),
          } as VoucherRowParsed;
        })
        .filter((x): x is VoucherRowParsed => x !== null);
      setRows(mapped);
      toast.success(`Parsed ${mapped.length} voucher rows`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Failed to parse: ${e.message || "unknown"}`);
    } finally { setBusy(false); }
  }

  async function postVouchers() {
    const sel = rows.filter((r) => r._selected);
    if (sel.length === 0) { toast.error("No rows selected"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Sign in required"); return; }
    setPosting(true);
    try {
      const { data: ledgers } = await supabase
        .from("ledgers").select("id, name, type").eq("company_id", companyId);
      const ledgerMap = new Map<string, { id: string; type: string }>(
        (ledgers || []).map((l) => [lc(l.name), { id: l.id, type: l.type }]),
      );
      // System ledgers we may need to auto-create
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
      for (const r of sel) {
        // Resolve party ledger (auto-create if missing)
        let partyId: string | null = null;
        if (r.party) {
          const sideHint: "Dr" | "Cr" =
            r.vtype === "sales" || r.vtype === "receipt" || r.vtype === "credit_note" ? "Dr" : "Cr";
          const guessCode = guessGroupCode(r.party, sideHint);
          const inferredType: LedgerType = (
            r.vtype === "sales" || r.vtype === "receipt" || r.vtype === "credit_note"
              ? "sundry_debtor"
              : r.vtype === "purchase" || r.vtype === "payment" || r.vtype === "debit_note"
              ? "sundry_creditor"
              : (defaultLedgerTypeForGroup(guessCode) ?? "current_asset")
          ) as LedgerType;
          partyId = await ensureLedger(r.party, inferredType);
        }
        // Counter ledger (Sales / Purchase / Cash etc.)
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

        // Build entries
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
      toast.success(`Vouchers imported — ${created} created${skipped ? `, ${skipped} skipped` : ""}`);
      setRows([]);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally { setPosting(false); }
  }

  const selected = rows.filter((r) => r._selected).length;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Tally XML / Daybook export, CSV, or Excel</Label>
        <Input type="file" accept=".xml,.csv,.txt,.xlsx,.xls" disabled={disabled || busy}
          onChange={(e) => onFile(e.target.files?.[0] || null)} />
        <p className="text-[11px] text-muted-foreground">
          Tally: Display → Day Book → Alt+E (Export) → XML. Busy: Display → Account Books → Day Book → Export. Each row becomes one voucher with a basic two-leg posting (party vs Sales / Purchase / Cash). For complex multi-line vouchers, edit them after import.
        </p>
      </div>
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{selected} of {rows.length} selected</div>
            <Button onClick={postVouchers} disabled={posting || disabled || selected === 0}>
              {posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import {selected}</>}
            </Button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Vch No</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Amount ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => (
                  <TableRow key={r._key}>
                    <TableCell>
                      <input type="checkbox" checked={r._selected}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRows((rs) => rs.map((x, i) => i === idx ? { ...x, _selected: v } : x));
                        }} />
                    </TableCell>
                    <TableCell className="text-xs">{r.date}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{r.vtype}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.voucher_no}</TableCell>
                    <TableCell className="text-sm">{r.party}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}