import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileJson, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { exportGstr1UsingOfficialTemplate, prefetchGstr1Template } from "@/lib/gstr1-template-export";
import {
  buildGstr1, fetchVouchers, fetchCompanyMeta, gstr1ToJson,
  gstr1ToXlsxSheets, monthRange, quarterRange, periodFP, downloadJson, validateGstr1,
  type VoucherRow, type CompanyMeta, type BuiltGstr1,
} from "@/lib/gst-returns";
import { downloadXlsx } from "@/lib/exporters";
import { toast } from "sonner";

import { ValidationPanel } from "@/components/reports/ValidationPanel";
import { PeriodLockCard } from "@/components/reports/PeriodLockCard";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { GstSectionTable } from "@/components/reports/GstSectionTable";

export const Route = createFileRoute("/app/reports/gstr1")({
  head: () => ({ meta: [{ title: "GSTR-1 — Reports" }] }),
  component: GSTR1Page,
});

const monthsOfYear = (year: number): { value: string; label: string }[] => {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names.map((n, i) => ({
    value: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: `${n} ${year}`,
  }));
};

function GSTR1Page() {
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const fyYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();

  // Warm the 7 MB official template cache in the background so Export is
  // instant once the user clicks. Silent on failure — export falls back
  // to a plain workbook if the CDN is unreachable.
  useEffect(() => { prefetchGstr1Template(); }, []);

  const [cadence, setCadence] = useState<"monthly" | "quarterly">("monthly");
  const [iffMode, setIffMode] = useState(false);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<string>(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(((Math.floor(today.getMonth() / 3) + 1) as 1 | 2 | 3 | 4));

  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [sales, setSales] = useState<VoucherRow[]>([]);
  const [cdnotes, setCdnotes] = useState<VoucherRow[]>([]);
  const [templateExporting, setTemplateExporting] = useState(false);
  const { view, setView } = useReportView("gstr1");

  // Determine effective period
  const period = useMemo(() => {
    if (cadence === "quarterly") {
      const r = quarterRange(year, quarter);
      return { ...r, fp: periodFP(r.to) };
    }
    const r = monthRange(month);
    return { ...r, fp: periodFP(r.from) };
  }, [cadence, year, quarter, month]);

  // Load company settings (for cadence default)
  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const meta = await fetchCompanyMeta(activeCompanyId);
      setCompany(meta);
      const { data: s } = await supabase
        .from("company_settings")
        .select("gst_filing_frequency")
        .eq("company_id", activeCompanyId)
        .maybeSingle();
      if (s?.gst_filing_frequency) setCadence(s.gst_filing_frequency as "monthly" | "quarterly");
    })();
  }, [activeCompanyId]);

  // Load vouchers for the period
  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [s, cn] = await Promise.all([
        fetchVouchers(activeCompanyId, period.from, period.to, ["sales"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["credit_note", "debit_note"]),
      ]);
      setSales(s);
      setCdnotes(cn);
    })();
  }, [activeCompanyId, period.from, period.to]);

  const built: BuiltGstr1 | null = useMemo(() => {
    if (!company) return null;
    return buildGstr1({
      company,
      from: period.from,
      to: period.to,
      fp: period.fp,
      sales,
      creditNotes: cdnotes,
      iffOnly: iffMode,
    });
  }, [company, sales, cdnotes, period, iffMode]);

  const fileBase = `GSTR1_${company?.gstin || "GSTIN"}_${period.fp}${iffMode ? "_IFF" : ""}`;

  const runTemplateExport = async (b: BuiltGstr1, name: string) => {
    if (templateExporting) return;
    setTemplateExporting(true);
    const tId = toast.loading("Preparing GSTR-1 Excel…", {
      description: "Creating the official workbook locally. The app will remain responsive.",
    });
    try {
      await exportGstr1UsingOfficialTemplate(b, name);
      toast.success("GSTR-1 Excel ready", { id: tId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith("GSTR-1 reconciliation failed:")) {
        toast.error("GSTR-1 export blocked — totals do not tally", {
          id: tId,
          description: message,
        });
        return;
      }
      toast.warning("Offline-Tool template unavailable — exported plain workbook instead", {
        id: tId,
        description: message,
      });
      downloadXlsx(name, gstr1ToXlsxSheets(b));
    } finally {
      setTemplateExporting(false);
    }
  };

  const validationOpts = { annualTurnoverPaise: company?.annual_turnover_paise ?? 0 };
  const preExportHsnErrors = (b: BuiltGstr1): string[] =>
    validateGstr1(b, validationOpts).filter((i) => i.level === "error" && i.section.startsWith("hsn")).map((i) => i.message);


  const onDownloadJson = () => {
    if (!built) return;
    const hsnErrs = preExportHsnErrors(built);
    if (hsnErrs.length) {
      toast.error("GSTR-1 export blocked — fix HSN/UQC errors first", {
        description: `${hsnErrs.length} row(s) will be rejected by the portal. See the Validation panel above.`,
      });
      return;
    }
    try {
      downloadJson(`${fileBase}.json`, gstr1ToJson(built));
    } catch (e) {
      toast.error("GSTR-1 export blocked — totals do not tally", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };
  const onDownloadExcel = () => {
    if (!built) return;
    const hsnErrs = preExportHsnErrors(built);
    if (hsnErrs.length) {
      toast.error("GSTR-1 export blocked — fix HSN/UQC errors first", {
        description: `${hsnErrs.length} row(s) will be rejected by the portal. See the Validation panel above.`,
      });
      return;
    }
    void runTemplateExport(built, `${fileBase}.xlsx`);
  };

  const exportQuarter = (iff: boolean) => {
    if (!company) return;
    const b = buildGstr1({
      company,
      from: period.from,
      to: period.to,
      fp: period.fp,
      sales,
      creditNotes: cdnotes,
      iffOnly: iff,
    });
    const name = `GSTR1_${company.gstin || "GSTIN"}_${period.fp}${iff ? "_IFF_B2B_CDNR" : "_Quarterly_Full"}.xlsx`;
    void runTemplateExport(b, name);
  };


  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Filing frequency</Label>
              <Select value={cadence} onValueChange={(v) => { setCadence(v as "monthly" | "quarterly"); setIffMode(false); }}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly (QRMP)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {cadence === "monthly" ? (
              <div className="space-y-1">
                <Label className="text-xs">Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[fyYear, fyYear + 1].flatMap((y) => monthsOfYear(y)).map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Year</Label>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[fyYear - 1, fyYear, fyYear + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quarter</Label>
                  <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v) as 1 | 2 | 3 | 4)}>
                    <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Q1 (Apr–Jun)</SelectItem>
                      <SelectItem value="2">Q2 (Jul–Sep)</SelectItem>
                      <SelectItem value="3">Q3 (Oct–Dec)</SelectItem>
                      <SelectItem value="4">Q4 (Jan–Mar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-1">
                  <Switch id="iff" checked={iffMode} onCheckedChange={setIffMode} />
                  <Label htmlFor="iff" className="text-xs">IFF (only B2B)</Label>
                </div>
              </>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <ViewSwitcher view={view} onChange={setView} classicLabel="Table" />
              {cadence === "quarterly" ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => exportQuarter(false)} disabled={!company}>
                    <FileSpreadsheet className="mr-1 h-4 w-4" /> Full Quarter (3 months)
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportQuarter(true)} disabled={!company}>
                    <FileSpreadsheet className="mr-1 h-4 w-4" /> IFF only (B2B + CDNR)
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => built && downloadXlsx(`${fileBase}.xlsx`, gstr1ToXlsxSheets(built))} disabled={!built}>
                    <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel (fast)
                  </Button>
                   <Button variant="outline" size="sm" onClick={onDownloadExcel} disabled={!built || templateExporting}>
                     <FileSpreadsheet className="mr-1 h-4 w-4" /> {templateExporting ? "Preparing…" : "Offline Tool Format"}
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={onDownloadJson} disabled={!built}>
                <FileJson className="mr-1 h-4 w-4" /> GSTN JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Period: <strong>{period.from}</strong> to <strong>{period.to}</strong> · FP <code>{period.fp}</code>
            {iffMode && " · IFF mode (only B2B + CDNR registered)"}
          </p>
        </CardContent>
      </Card>

      {built && (
        <>
          <ValidationPanel issues={validateGstr1(built)} />

          <PeriodLockCard
            returnType="GSTR1"
            period={cadence === "quarterly" ? `${year}-Q${quarter}` : month}
            periodStart={period.from}
            periodEnd={period.to}
            periodLabel={
              cadence === "quarterly"
                ? `Q${quarter} ${year}`
                : new Date(period.from).toLocaleString("en-IN", { month: "short", year: "numeric" })
            }
          />

          <GstSectionTable view={view} reportId="gstr1" title={`B2B (${built.b2b.length})`} headers={["GSTIN", "Invoice", "Date", "POS", "Value", "Taxable", "IGST", "CGST", "SGST"]}
            rows={built.b2b.map((x) => [x.ctin, x.inum, x.idt, x.pos, money(x.val), money(sumLine(x.itms, "txval")), money(sumLine(x.itms, "iamt")), money(sumLine(x.itms, "camt")), money(sumLine(x.itms, "samt"))])} />

          <GstSectionTable view={view} reportId="gstr1" title={`B2CL (${built.b2cl.length}) — Inter-state to URP > ₹2.5L`} headers={["Invoice", "Date", "POS", "Value", "Taxable", "IGST"]}
            rows={built.b2cl.map((x) => [x.inum, x.idt, x.pos, money(x.val), money(sumLine(x.itms, "txval")), money(sumLine(x.itms, "iamt"))])} />

          <GstSectionTable view={view} reportId="gstr1" title={`B2CS (${built.b2cs.length}) — Other unregistered`} headers={["Type", "POS", "Rate", "Taxable", "IGST", "CGST", "SGST"]}
            rows={built.b2cs.map((x) => [x.sply_ty, x.pos, `${x.rt}%`, money(x.txval), money(x.iamt), money(x.camt), money(x.samt)])} />

          <GstSectionTable view={view} reportId="gstr1" title={`CDNR (${built.cdnr.length}) — Credit/Debit notes (registered)`} headers={["GSTIN", "Note", "Date", "Type", "POS", "Value", "Taxable"]}
            rows={built.cdnr.map((x) => [x.ctin, x.nt_num, x.nt_dt, x.ntty, x.pos, money(x.val), money(sumLine(x.itms, "txval"))])} />

          <GstSectionTable view={view} reportId="gstr1" title={`CDNUR (${built.cdnur.length}) — Notes to unregistered / exports`} headers={["Type", "Note", "Date", "POS", "Value"]}
            rows={built.cdnur.map((x) => [x.typ, x.nt_num, x.nt_dt, x.pos, money(x.val)])} />

          <GstSectionTable view={view} reportId="gstr1" title={`EXP (${built.exp.length}) — Exports & SEZ`} headers={["Type", "Invoice", "Date", "Port", "SB No", "SB Date", "Value"]}
            rows={built.exp.map((e) => [e.exp_typ, e.inum, e.idt, e.sbpcode || "", e.sbnum || "", e.sbdt || "", money(e.val)])} />

          {(() => {
            const nilLabels: Record<string, string> = {
              INTRB2B: "Inter-State — Registered (B2B)",
              INTRB2C: "Inter-State — Unregistered (B2C)",
              INTRAB2B: "Intra-State — Registered (B2B)",
              INTRAB2C: "Intra-State — Unregistered (B2C)",
            };
            const order = ["INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C"] as const;
            const byKey = new Map<string, { sply_ty: string; nil_amt: number; expt_amt: number; ngsup_amt: number }>(built.nil.map((n) => [n.sply_ty, n]));
            const rows: (string | number)[][] = order
              .map((k) => byKey.get(k) ?? { sply_ty: k, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 })
              .filter((n) => n.nil_amt || n.expt_amt || n.ngsup_amt)
              .map((n) => [nilLabels[n.sply_ty] ?? n.sply_ty, money(n.nil_amt), money(n.expt_amt), money(n.ngsup_amt), money(n.nil_amt + n.expt_amt + n.ngsup_amt)]);
            const tot = built.nil.reduce((a, n) => ({ nil: a.nil + n.nil_amt, ex: a.ex + n.expt_amt, ng: a.ng + n.ngsup_amt }), { nil: 0, ex: 0, ng: 0 });
            if (rows.length) rows.push(["Total", money(tot.nil), money(tot.ex), money(tot.ng), money(tot.nil + tot.ex + tot.ng)]);
            return (
              <GstSectionTable view={view} reportId="gstr1"
                title={`NIL / Exempted / Non-GST — split by inter/intra-state × registered/unregistered`}
                headers={["Classification", "Nil-rated", "Exempted", "Non-GST", "Total"]}
                rows={rows} />
            );
          })()}


          {built.b2ba.length > 0 && (
            <GstSectionTable view={view} reportId="gstr1" title={`B2BA (${built.b2ba.length}) — B2B Amendments`} headers={["GSTIN", "Orig Inv", "Orig Date", "New Inv", "New Date", "Value"]}
              rows={built.b2ba.map((x) => [x.ctin, x.oinum, x.oidt, x.inum, x.idt, money(x.val)])} />
          )}
          {built.cdnra.length > 0 && (
            <GstSectionTable view={view} reportId="gstr1" title={`CDNRA (${built.cdnra.length}) — Note Amendments`} headers={["GSTIN", "Orig Note", "Orig Date", "New Note", "New Date", "Value"]}
              rows={built.cdnra.map((x) => [x.ctin, x.ont_num, x.ont_dt, x.nt_num, x.nt_dt, money(x.val)])} />
          )}

          <GstSectionTable view={view} reportId="gstr1" title={`HSN — B2B (${built.hsn_b2b.length}) — Supplies to registered persons`} headers={["HSN", "UQC", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST", "Total"]}
            rows={built.hsn_b2b.map((h) => [h.hsn_sc, h.uqc, h.qty, `${h.rt}%`, money(h.txval), money(h.iamt), money(h.camt), money(h.samt), money(h.val)])} />

          <GstSectionTable view={view} reportId="gstr1" title={`HSN — B2C (${built.hsn_b2c.length}) — Supplies to unregistered persons`} headers={["HSN", "UQC", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST", "Total"]}
            rows={built.hsn_b2c.map((h) => [h.hsn_sc, h.uqc, h.qty, `${h.rt}%`, money(h.txval), money(h.iamt), money(h.camt), money(h.samt), money(h.val)])} />

          {(() => {
            const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
            const b2bVal = sum(built.b2b.map((x) => x.val));
            const b2clVal = sum(built.b2cl.map((x) => x.val));
            const b2csVal = sum(built.b2cs.map((x) => x.txval + x.iamt + x.camt + x.samt));
            const expVal = sum(built.exp.map((x) => x.val));
            const nilVal = sum(built.nil.map((n) => n.nil_amt + n.expt_amt + n.ngsup_amt));
            const cdnrVal = sum(built.cdnr.map((x) => x.val));
            const cdnurVal = sum(built.cdnur.map((x) => x.val));
            const salesGross = b2bVal + b2clVal + b2csVal + expVal + nilVal;
            const netSales = salesGross - cdnrVal - cdnurVal;
            const hsnB2B = sum(built.hsn_b2b.map((h) => h.val));
            const hsnB2C = sum(built.hsn_b2c.map((h) => h.val));
            const hsnTotal = hsnB2B + hsnB2C;
            const diff = netSales - hsnTotal;
            return (
              <GstSectionTable view={view} reportId="gstr1"
                title={`Reconciliation — Sales (net of CN/DN) vs HSN Summary`}
                headers={["Component", "Amount"]}
                rows={[
                  ["B2B", money(b2bVal)],
                  ["B2CL", money(b2clVal)],
                  ["B2CS", money(b2csVal)],
                  ["EXP", money(expVal)],
                  ["NIL / Exempt / Non-GST", money(nilVal)],
                  ["Sub-total (outward)", money(salesGross)],
                  ["Less: CDNR (registered)", money(-cdnrVal)],
                  ["Less: CDNUR (unregistered)", money(-cdnurVal)],
                  ["Net outward supplies (A)", money(netSales)],
                  ["HSN — B2B", money(hsnB2B)],
                  ["HSN — B2C", money(hsnB2C)],
                  ["HSN total (B)", money(hsnTotal)],
                  ["Difference (A − B)", money(diff)],
                ]} />
            );
          })()}

          <GstSectionTable view={view} reportId="gstr1" title={`Documents Issued (${built.docs.length})`} headers={["Type", "From", "To", "Total", "Cancelled", "Net"]}
            rows={built.docs.map((d) => [d.doc_typ, d.from, d.to, d.totnum, d.cancel, d.net_issue])} />

        </>
      )}
    </div>
  );
}

function money(v: number): string {
  return formatINR(Math.round(v * 100));
}

function sumLine<K extends "txval" | "iamt" | "camt" | "samt" | "csamt">(itms: { itm_det: Record<K, number> }[], k: K): number {
  return itms.reduce((s, l) => s + (l.itm_det[k] || 0), 0);
}

