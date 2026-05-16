import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { toast } from "sonner";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { GstSectionTable } from "@/components/reports/GstSectionTable";

export const Route = createFileRoute("/app/reports/gstr2b")({
  head: () => ({ meta: [{ title: "GSTR-2B Reconciliation — Reports" }] }),
  component: Gstr2BPage,
});

interface G2BLine {
  id: string;
  supplier_gstin: string;
  supplier_name: string | null;
  invoice_no: string;
  invoice_date: string | null;
  invoice_value_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  match_status: string;
  matched_voucher_id: string | null;
}
interface Purchase {
  id: string; voucher_number: string; voucher_date: string; total_paise: number;
  vendor_invoice_no: string | null;
  ledgers: { name: string; gstin: string | null } | null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}
const toPaise = (s: string | number) => Math.round((typeof s === "number" ? s : parseFloat(String(s).replace(/[, ]/g, "")) || 0) * 100);

interface ParsedRow {
  supplier_gstin: string; supplier_name: string; invoice_no: string; invoice_date: string | null;
  invoice_value_paise: number; taxable_paise: number; igst_paise: number; cgst_paise: number; sgst_paise: number;
}

function parseGstr2bCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iGstin = idx(["gstin"]);
  const iName = idx(["trade name", "supplier name", "legal name"]);
  const iInv = idx(["invoice number", "invoice no", "doc no"]);
  const iDate = idx(["invoice date", "doc date"]);
  const iVal = idx(["invoice value", "doc value"]);
  const iTax = idx(["taxable"]);
  const iIgst = idx(["integrated", "igst"]);
  const iCgst = idx(["central", "cgst"]);
  const iSgst = idx(["state", "sgst"]);
  const out: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    if (iGstin < 0 || !c[iGstin]) continue;
    out.push({
      supplier_gstin: (c[iGstin] || "").trim().toUpperCase(),
      supplier_name: (c[iName] || "").trim(),
      invoice_no: (c[iInv] || "").trim(),
      invoice_date: iDate >= 0 ? parseDate(c[iDate] || "") : null,
      invoice_value_paise: iVal >= 0 ? toPaise(c[iVal]) : 0,
      taxable_paise: iTax >= 0 ? toPaise(c[iTax]) : 0,
      igst_paise: iIgst >= 0 ? toPaise(c[iIgst]) : 0,
      cgst_paise: iCgst >= 0 ? toPaise(c[iCgst]) : 0,
      sgst_paise: iSgst >= 0 ? toPaise(c[iSgst]) : 0,
    });
  }
  return out;
}

function parseGstr2bJson(text: string): ParsedRow[] {
  try {
    const j = JSON.parse(text);
    const out: ParsedRow[] = [];
    // Standard GSTN 2B JSON: data.docdata.b2b[].inv[]
    const b2bSuppliers = j?.data?.docdata?.b2b ?? j?.docdata?.b2b ?? j?.b2b ?? [];
    for (const s of b2bSuppliers) {
      const gstin = (s.ctin || s.supplierGSTIN || "").toUpperCase();
      const name = s.trdnm || s.supplierName || "";
      for (const inv of s.inv || []) {
        const itms = inv.itms || [];
        const tax = itms.reduce((acc: { tax: number; ig: number; cg: number; sg: number }, it: { txval?: number; igst?: number; cgst?: number; sgst?: number }) => ({
          tax: acc.tax + (it.txval || 0),
          ig: acc.ig + (it.igst || 0),
          cg: acc.cg + (it.cgst || 0),
          sg: acc.sg + (it.sgst || 0),
        }), { tax: 0, ig: 0, cg: 0, sg: 0 });
        out.push({
          supplier_gstin: gstin,
          supplier_name: name,
          invoice_no: inv.inum || inv.invoiceNumber || "",
          invoice_date: parseDate(inv.idt || inv.invoiceDate || ""),
          invoice_value_paise: toPaise(inv.val || 0),
          taxable_paise: toPaise(tax.tax),
          igst_paise: toPaise(tax.ig),
          cgst_paise: toPaise(tax.cg),
          sgst_paise: toPaise(tax.sg),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function Gstr2BPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
  });
  const [lines, setLines] = useState<G2BLine[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const { view, setView } = useReportView("gstr2b");
  const [importId, setImportId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("vouchers")
      .select("id, voucher_number, voucher_date, total_paise, vendor_invoice_no, ledgers:party_ledger_id(name, gstin)")
      .eq("company_id", activeCompanyId)
      .eq("voucher_type", "purchase")
      .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false })
      .limit(2000)
      .then(({ data }) => setPurchases((data || []) as unknown as Purchase[]));
  }, [activeCompanyId]);

  async function loadLines(impId: string) {
    const { data } = await supabase.from("gstr2b_lines").select("*").eq("import_id", impId);
    setLines((data || []) as G2BLine[]);
  }

  async function onUpload(file: File) {
    if (!activeCompanyId) return;
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith(".json");
    const parsed = isJson ? parseGstr2bJson(text) : parseGstr2bCsv(text);
    if (!parsed.length) { toast.error("No rows parsed — check file format"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: imp, error: ie } = await supabase.from("gstr2b_imports").insert({
      company_id: activeCompanyId, period, source: isJson ? "json" : "csv",
      file_name: file.name, total_lines: parsed.length, imported_by: user.id,
    }).select("id").single();
    if (ie || !imp) { toast.error(ie?.message || "Import failed"); return; }
    // Try matching against purchases
    const rows = parsed.map((p) => {
      const match = purchases.find((pu) =>
        pu.ledgers?.gstin?.toUpperCase() === p.supplier_gstin &&
        (pu.vendor_invoice_no || "").trim().toLowerCase() === p.invoice_no.trim().toLowerCase()
      );
      return {
        company_id: activeCompanyId,
        import_id: imp.id,
        supplier_gstin: p.supplier_gstin,
        supplier_name: p.supplier_name,
        invoice_no: p.invoice_no,
        invoice_date: p.invoice_date,
        invoice_value_paise: p.invoice_value_paise,
        taxable_paise: p.taxable_paise,
        igst_paise: p.igst_paise,
        cgst_paise: p.cgst_paise,
        sgst_paise: p.sgst_paise,
        match_status: match
          ? (Math.abs(match.total_paise - p.invoice_value_paise) <= 100 ? "matched" : "mismatch")
          : "unmatched",
        matched_voucher_id: match?.id ?? null,
      };
    });
    const { error } = await supabase.from("gstr2b_lines").insert(rows);
    if (error) { toast.error(error.message); return; }
    const matched = rows.filter((r) => r.match_status === "matched").length;
    await supabase.from("gstr2b_imports").update({ matched_lines: matched }).eq("id", imp.id);
    setImportId(imp.id);
    loadLines(imp.id);
    toast.success(`Imported ${parsed.length} rows · ${matched} matched`);
  }

  // Missing ITC: purchase exists in books but not in 2B
  const missing = useMemo(() => {
    if (!lines.length) return [] as Purchase[];
    const set = new Set(lines.map((l) => `${l.supplier_gstin}|${l.invoice_no.trim().toLowerCase()}`));
    return purchases.filter((p) => {
      if (!p.ledgers?.gstin || !p.vendor_invoice_no) return false;
      return !set.has(`${p.ledgers.gstin.toUpperCase()}|${p.vendor_invoice_no.trim().toLowerCase()}`);
    });
  }, [lines, purchases]);

  const stats = useMemo(() => ({
    matched: lines.filter((l) => l.match_status === "matched").length,
    mismatch: lines.filter((l) => l.match_status === "mismatch").length,
    unmatched: lines.filter((l) => l.match_status === "unmatched").length,
  }), [lines]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Period (MMYYYY)</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="042026" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Upload GSTR-2B (CSV or JSON from GST portal)</Label>
            <Input type="file" accept=".csv,.json" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </div>
          <div className="text-xs flex items-end gap-2 flex-wrap">
            <Badge variant="default">{stats.matched} matched</Badge>
            <Badge variant="secondary">{stats.mismatch} mismatch</Badge>
            <Badge variant="outline">{stats.unmatched} unmatched</Badge>
            <div className="ml-auto"><ViewSwitcher view={view} onChange={setView} classicLabel="Table" /></div>
          </div>
        </CardContent>
      </Card>

      {lines.length > 0 && (
        view === "grid" ? (
          <GstSectionTable
            view={view}
            reportId="gstr2b"
            title="2B lines vs Purchase Register"
            headers={["Supplier GSTIN", "Supplier", "Inv No", "Inv Date", "Status", "Value", "IGST", "CGST", "SGST"]}
            rows={lines.map((l) => [
              l.supplier_gstin,
              l.supplier_name ?? "",
              l.invoice_no,
              l.invoice_date ?? "",
              l.match_status,
              formatINR(l.invoice_value_paise),
              formatINR(l.igst_paise),
              formatINR(l.cgst_paise),
              formatINR(l.sgst_paise),
            ])}
            numericFromCol={5}
          />
        ) : (
        <Card>
          <CardContent className="p-0">
            <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">2B lines vs Purchase Register</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier GSTIN</TableHead><TableHead>Supplier</TableHead>
                <TableHead>Inv No</TableHead><TableHead>Inv Date</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.supplier_gstin}</TableCell>
                    <TableCell className="text-xs">{l.supplier_name}</TableCell>
                    <TableCell className="font-mono text-xs">{l.invoice_no}</TableCell>
                    <TableCell className="font-mono text-xs">{l.invoice_date || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.invoice_value_paise)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.igst_paise)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.cgst_paise)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.sgst_paise)}</TableCell>
                    <TableCell>
                      {l.match_status === "matched" && <Badge variant="default">Matched</Badge>}
                      {l.match_status === "mismatch" && <Badge variant="secondary">Value Mismatch</Badge>}
                      {l.match_status === "unmatched" && <Badge variant="outline">Not in books</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        )
      )}

      {view === "grid" && missing.length > 0 ? (
        <GstSectionTable
          view={view}
          reportId="gstr2b"
          title={`Missing ITC: purchases in your books not appearing in GSTR-2B (${missing.length})`}
          headers={["Date", "Voucher #", "Supplier", "GSTIN", "Vendor Inv #", "Value"]}
          rows={missing.map((p) => [
            fmtIndianDate(p.voucher_date),
            p.voucher_number,
            p.ledgers?.name || "—",
            p.ledgers?.gstin || "—",
            p.vendor_invoice_no || "—",
            formatINR(p.total_paise),
          ])}
          numericFromCol={5}
        />
      ) : (
      <Card>
        <CardContent className="p-0">
          <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-destructive">
            Missing ITC: purchases in your books not appearing in GSTR-2B ({missing.length})
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Voucher #</TableHead>
              <TableHead>Supplier</TableHead><TableHead>GSTIN</TableHead>
              <TableHead>Vendor Inv #</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {missing.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="p-6 text-center text-sm text-muted-foreground">{lines.length === 0 ? "Upload a 2B file to compare." : "All ITC accounted for."}</TableCell></TableRow>
              ) : missing.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{fmtIndianDate(p.voucher_date)}</TableCell>
                  <TableCell>{p.voucher_number}</TableCell>
                  <TableCell>{p.ledgers?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.ledgers?.gstin || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.vendor_invoice_no || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(p.total_paise)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
