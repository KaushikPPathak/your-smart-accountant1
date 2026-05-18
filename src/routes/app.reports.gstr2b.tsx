import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { toast } from "sonner";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { GstSectionTable } from "@/components/reports/GstSectionTable";
import {
  parseAny,
  reconcile,
  DEFAULT_TOLERANCES,
  type ReconTolerances,
  type ReconResult,
  normGstin,
  normInvoiceNo,
} from "@/lib/gstr2b-recon";

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
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  match_status: string;
  matched_voucher_id: string | null;
  remarks: string | null;
  manual_override: boolean;
}
interface Purchase {
  id: string; voucher_number: string; voucher_date: string; total_paise: number;
  vendor_invoice_no: string | null;
  ledgers: { name: string; gstin: string | null } | null;
}

const STATUS_VARIANTS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  matched: { label: "Matched", variant: "default" },
  matched_with_tolerance: { label: "Matched (±tol)", variant: "default" },
  manual_match: { label: "Matched (manual)", variant: "default" },
  accept_as_matched: { label: "Accepted", variant: "default" },
  value_mismatch: { label: "Value Δ", variant: "secondary" },
  tax_mismatch: { label: "Tax Δ", variant: "secondary" },
  date_mismatch: { label: "Date Δ", variant: "secondary" },
  invoice_no_mismatch: { label: "Inv# Δ", variant: "secondary" },
  probable_match: { label: "Probable", variant: "secondary" },
  unmatched: { label: "Not in books", variant: "outline" },
};

const MATCHED_STATUSES = new Set(["matched", "matched_with_tolerance", "manual_match", "accept_as_matched"]);

function Gstr2BPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
  });
  const [lines, setLines] = useState<G2BLine[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const { view, setView } = useReportView("gstr2b");
  const [tol, setTol] = useState<ReconTolerances>(DEFAULT_TOLERANCES);
  const [busy, setBusy] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("vouchers")
      .select("id, voucher_number, voucher_date, total_paise, vendor_invoice_no, ledgers:party_ledger_id(name, gstin)")
      .eq("company_id", activeCompanyId)
      .eq("voucher_type", "purchase")
      .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false })
      .limit(5000)
      .then(({ data }) => setPurchases((data || []) as unknown as Purchase[]));
  }, [activeCompanyId]);

  // Load most-recent import on mount
  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("gstr2b_imports")
      .select("id, period")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const imp = data?.[0];
        if (imp) { setPeriod(imp.period); loadLines(imp.id); }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  async function loadLines(impId: string) {
    const { data } = await supabase.from("gstr2b_lines").select("*").eq("import_id", impId);
    setLines((data || []) as G2BLine[]);
  }

  async function onUpload(file: File) {
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      const ext = file.name.toLowerCase().split(".").pop() || "";
      const parsed = await parseAny(file);
      if (!parsed.length) { toast.error("No rows parsed — check file format"); return; }

      const results = reconcile(parsed, purchases, tol);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const source = ext === "json" ? "json" : ext === "xlsx" || ext === "xls" ? "xlsx" : "csv";
      const { data: imp, error: ie } = await supabase.from("gstr2b_imports").insert({
        company_id: activeCompanyId, period, source,
        file_name: file.name, total_lines: parsed.length, imported_by: user.id,
      }).select("id").single();
      if (ie || !imp) { toast.error(ie?.message || "Import failed"); return; }

      const rows = results.map((r) => ({
        company_id: activeCompanyId,
        import_id: imp.id,
        supplier_gstin: r.row.supplier_gstin,
        supplier_name: r.row.supplier_name,
        invoice_no: r.row.invoice_no,
        invoice_date: r.row.invoice_date,
        invoice_value_paise: r.row.invoice_value_paise,
        taxable_paise: r.row.taxable_paise,
        igst_paise: r.row.igst_paise,
        cgst_paise: r.row.cgst_paise,
        sgst_paise: r.row.sgst_paise,
        cess_paise: r.row.cess_paise ?? 0,
        match_status: r.match_status,
        matched_voucher_id: r.matched_voucher_id,
      }));
      const { error } = await supabase.from("gstr2b_lines").insert(rows);
      if (error) { toast.error(error.message); return; }
      const matched = rows.filter((r) => MATCHED_STATUSES.has(r.match_status)).length;
      await supabase.from("gstr2b_imports").update({ matched_lines: matched }).eq("id", imp.id);
      await loadLines(imp.id);
      toast.success(`Imported ${parsed.length} rows · ${matched} matched`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function rerunInMemory() {
    if (!lines.length) return;
    const parsed = lines.map((l) => ({
      supplier_gstin: l.supplier_gstin,
      supplier_name: l.supplier_name || "",
      invoice_no: l.invoice_no,
      invoice_date: l.invoice_date,
      invoice_value_paise: l.invoice_value_paise,
      taxable_paise: l.taxable_paise,
      igst_paise: l.igst_paise,
      cgst_paise: l.cgst_paise,
      sgst_paise: l.sgst_paise,
      cess_paise: 0,
    }));
    const results = reconcile(parsed, purchases, tol);
    const byKey = new Map<string, ReconResult>();
    results.forEach((r) => byKey.set(`${r.row.supplier_gstin}|${r.row.invoice_no}`, r));
    setLines((prev) => prev.map((l) => {
      if (l.manual_override) return l; // never overwrite manual decisions
      const r = byKey.get(`${l.supplier_gstin}|${l.invoice_no}`);
      return r ? { ...l, match_status: r.match_status, matched_voucher_id: r.matched_voucher_id } : l;
    }));
    toast.success("Re-matched (manual overrides preserved)");
  }

  // Inline edit helpers — optimistic + persist
  async function patchLine(id: string, patch: Partial<G2BLine>) {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
    const { error } = await supabase.from("gstr2b_lines").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  async function acceptAsMatched(l: G2BLine) {
    await patchLine(l.id, { match_status: "accept_as_matched", manual_override: true });
    toast.success("Marked as matched");
  }
  async function linkVoucher(l: G2BLine, voucherId: string) {
    if (!voucherId) {
      await patchLine(l.id, { matched_voucher_id: null, manual_override: false });
      return;
    }
    await patchLine(l.id, { matched_voucher_id: voucherId, match_status: "manual_match", manual_override: true });
    toast.success("Linked to voucher");
  }
  async function clearManual(l: G2BLine) {
    await patchLine(l.id, { manual_override: false, match_status: "unmatched", matched_voucher_id: null });
  }

  const missing = useMemo(() => {
    if (!lines.length) return [] as Purchase[];
    const matchedIds = new Set(lines.map((l) => l.matched_voucher_id).filter(Boolean) as string[]);
    return purchases.filter((p) => {
      if (!p.ledgers?.gstin || !p.vendor_invoice_no) return false;
      return !matchedIds.has(p.id);
    });
  }, [lines, purchases]);

  const stats = useMemo(() => ({
    matched: lines.filter((l) => MATCHED_STATUSES.has(l.match_status)).length,
    mismatch: lines.filter((l) => ["value_mismatch", "tax_mismatch", "date_mismatch", "invoice_no_mismatch", "probable_match"].includes(l.match_status)).length,
    unmatched: lines.filter((l) => l.match_status === "unmatched").length,
  }), [lines]);

  const visibleLines = useMemo(() =>
    onlyMismatch ? lines.filter((l) => !MATCHED_STATUSES.has(l.match_status)) : lines,
  [lines, onlyMismatch]);

  // Candidate purchases for a given 2B line — same GSTIN preferred, fallback to all
  function candidatesFor(l: G2BLine): Purchase[] {
    const g = normGstin(l.supplier_gstin);
    const same = purchases.filter((p) => normGstin(p.ledgers?.gstin || "") === g);
    return (same.length ? same : purchases).slice(0, 200);
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { font-size: 11px; }
          .print-area table { width: 100%; border-collapse: collapse; }
          .print-area th, .print-area td { border: 1px solid #999; padding: 3px 5px; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      <Card className="no-print">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Period (MMYYYY)</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="042026" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Upload GSTR-2B (JSON · Excel · CSV)</Label>
            <Input type="file" accept=".csv,.json,.xlsx,.xls" disabled={busy} onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </div>
          <div className="text-xs flex items-end gap-2 flex-wrap">
            <Badge variant="default">{stats.matched} matched</Badge>
            <Badge variant="secondary">{stats.mismatch} review</Badge>
            <Badge variant="outline">{stats.unmatched} unmatched</Badge>
            <div className="ml-auto flex gap-2">
              <ViewSwitcher view={view} onChange={setView} classicLabel="Table" />
              <Button size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="no-print">
        <CardContent className="p-4">
          <div className="text-xs font-semibold mb-2">Reconciliation tolerances</div>
          <div className="grid gap-3 md:grid-cols-5 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Invoice value ± ₹</Label>
              <Input type="number" min={0} value={tol.valuePaise / 100}
                onChange={(e) => setTol((t) => ({ ...t, valuePaise: Math.round(Number(e.target.value || 0) * 100) }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Per tax head ± ₹</Label>
              <Input type="number" min={0} value={tol.taxPaise / 100}
                onChange={(e) => setTol((t) => ({ ...t, taxPaise: Math.round(Number(e.target.value || 0) * 100) }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date ± days</Label>
              <Input type="number" min={0} value={tol.dateDays}
                onChange={(e) => setTol((t) => ({ ...t, dateDays: Math.max(0, Number(e.target.value || 0)) }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={tol.ignoreDate} onCheckedChange={(v) => setTol((t) => ({ ...t, ignoreDate: v }))} />
              <Label className="text-xs">Ignore date</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={tol.ignoreInvoiceNo} onCheckedChange={(v) => setTol((t) => ({ ...t, ignoreInvoiceNo: v }))} />
              <Label className="text-xs">Ignore invoice no.</Label>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
            <div className="text-[11px] text-muted-foreground">
              Invoice numbers are normalised (case, spaces, dashes, slashes & leading zeros ignored).
              Manual overrides are preserved across re-matches.
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={onlyMismatch} onCheckedChange={setOnlyMismatch} />
                Show only mismatched / unmatched
              </label>
              <Button size="sm" variant="outline" onClick={rerunInMemory} disabled={!lines.length}>Re-match now</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {lines.length > 0 && (
        view === "grid" ? (
          <GstSectionTable
            view={view}
            reportId="gstr2b"
            title="2B lines vs Purchase Register"
            headers={["Supplier GSTIN", "Supplier", "Inv No", "Inv Date", "Status", "Value", "IGST", "CGST", "SGST", "Remarks"]}
            rows={visibleLines.map((l) => [
              l.supplier_gstin,
              l.supplier_name ?? "",
              l.invoice_no,
              l.invoice_date ?? "",
              STATUS_VARIANTS[l.match_status]?.label ?? l.match_status,
              formatINR(l.invoice_value_paise),
              formatINR(l.igst_paise),
              formatINR(l.cgst_paise),
              formatINR(l.sgst_paise),
              l.remarks ?? "",
            ])}
            numericFromCol={5}
          />
        ) : (
        <Card className="print-area">
          <CardContent className="p-0">
            <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold flex items-center justify-between">
              <span>2B lines vs Purchase Register · Period {period}</span>
              <span className="text-muted-foreground">
                {stats.matched} matched · {stats.mismatch} review · {stats.unmatched} unmatched
              </span>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier GSTIN</TableHead><TableHead>Supplier</TableHead>
                <TableHead>Inv No</TableHead><TableHead>Inv Date</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-[180px]">Remarks</TableHead>
                <TableHead className="no-print min-w-[220px]">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {visibleLines.map((l) => {
                  const sv = STATUS_VARIANTS[l.match_status] ?? { label: l.match_status, variant: "outline" as const };
                  const cands = candidatesFor(l);
                  return (
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
                      <Badge variant={sv.variant}>{sv.label}</Badge>
                      {l.manual_override ? <span className="ml-1 text-[10px] text-muted-foreground">(manual)</span> : null}
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={l.remarks ?? ""}
                        placeholder="Add note…"
                        className="h-7 text-xs"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if ((l.remarks ?? "") !== v) void patchLine(l.id, { remarks: v || null });
                        }}
                      />
                    </TableCell>
                    <TableCell className="no-print">
                      <div className="flex items-center gap-1">
                        <select
                          className="h-7 text-xs border rounded px-1 bg-background max-w-[160px]"
                          value={l.matched_voucher_id ?? ""}
                          onChange={(e) => void linkVoucher(l, e.target.value)}
                        >
                          <option value="">— link voucher —</option>
                          {cands.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.voucher_number} · {p.vendor_invoice_no || "—"} · {formatINR(p.total_paise)}
                            </option>
                          ))}
                        </select>
                        {!MATCHED_STATUSES.has(l.match_status) && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                            onClick={() => void acceptAsMatched(l)}>Accept</Button>
                        )}
                        {l.manual_override && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                            onClick={() => void clearManual(l)}>Reset</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
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
      <Card className="print-area">
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

export { normGstin, normInvoiceNo };
