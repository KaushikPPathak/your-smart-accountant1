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
import { downloadXlsx } from "@/lib/exporters";
import {
  buildGstr1, fetchVouchers, fetchCompanyMeta, gstr1ToJson, gstr1ToXlsxSheets,
  monthRange, quarterRange, periodFP, downloadJson, validateGstr1,
  type VoucherRow, type CompanyMeta, type BuiltGstr1,
} from "@/lib/gst-returns";
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

  const [cadence, setCadence] = useState<"monthly" | "quarterly">("monthly");
  const [iffMode, setIffMode] = useState(false);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<string>(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(((Math.floor(today.getMonth() / 3) + 1) as 1 | 2 | 3 | 4));

  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [sales, setSales] = useState<VoucherRow[]>([]);
  const [cdnotes, setCdnotes] = useState<VoucherRow[]>([]);

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

  const onDownloadJson = () => built && downloadJson(`${fileBase}.json`, gstr1ToJson(built));
  const onDownloadExcel = () => built && downloadXlsx(`${fileBase}.xlsx`, gstr1ToXlsxSheets(built));

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

            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={onDownloadExcel} disabled={!built}>
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Offline Tool Excel
              </Button>
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

          <SectionTable title={`B2B (${built.b2b.length})`} headers={["GSTIN", "Invoice", "Date", "POS", "Value", "Taxable", "IGST", "CGST", "SGST"]}
            rows={built.b2b.map((x) => [x.ctin, x.inum, x.idt, x.pos, money(x.val), money(sumLine(x.itms, "txval")), money(sumLine(x.itms, "iamt")), money(sumLine(x.itms, "camt")), money(sumLine(x.itms, "samt"))])} />

          <SectionTable title={`B2CL (${built.b2cl.length}) — Inter-state to URP > ₹2.5L`} headers={["Invoice", "Date", "POS", "Value", "Taxable", "IGST"]}
            rows={built.b2cl.map((x) => [x.inum, x.idt, x.pos, money(x.val), money(sumLine(x.itms, "txval")), money(sumLine(x.itms, "iamt"))])} />

          <SectionTable title={`B2CS (${built.b2cs.length}) — Other unregistered`} headers={["Type", "POS", "Rate", "Taxable", "IGST", "CGST", "SGST"]}
            rows={built.b2cs.map((x) => [x.sply_ty, x.pos, `${x.rt}%`, money(x.txval), money(x.iamt), money(x.camt), money(x.samt)])} />

          <SectionTable title={`CDNR (${built.cdnr.length}) — Credit/Debit notes (registered)`} headers={["GSTIN", "Note", "Date", "Type", "POS", "Value", "Taxable"]}
            rows={built.cdnr.map((x) => [x.ctin, x.nt_num, x.nt_dt, x.ntty, x.pos, money(x.val), money(sumLine(x.itms, "txval"))])} />

          <SectionTable title={`CDNUR (${built.cdnur.length}) — Notes to unregistered / exports`} headers={["Type", "Note", "Date", "POS", "Value"]}
            rows={built.cdnur.map((x) => [x.typ, x.nt_num, x.nt_dt, x.pos, money(x.val)])} />

          <SectionTable title={`EXP (${built.exp.length}) — Exports & SEZ`} headers={["Type", "Invoice", "Date", "Port", "SB No", "SB Date", "Value"]}
            rows={built.exp.map((e) => [e.exp_typ, e.inum, e.idt, e.sbpcode || "", e.sbnum || "", e.sbdt || "", money(e.val)])} />

          <SectionTable title={`NIL / Exempted / Non-GST (${built.nil.length})`} headers={["Type", "Nil-rated", "Exempted", "Non-GST"]}
            rows={built.nil.map((n) => [n.sply_ty, money(n.nil_amt), money(n.expt_amt), money(n.ngsup_amt)])} />

          {built.b2ba.length > 0 && (
            <SectionTable title={`B2BA (${built.b2ba.length}) — B2B Amendments`} headers={["GSTIN", "Orig Inv", "Orig Date", "New Inv", "New Date", "Value"]}
              rows={built.b2ba.map((x) => [x.ctin, x.oinum, x.oidt, x.inum, x.idt, money(x.val)])} />
          )}
          {built.cdnra.length > 0 && (
            <SectionTable title={`CDNRA (${built.cdnra.length}) — Note Amendments`} headers={["GSTIN", "Orig Note", "Orig Date", "New Note", "New Date", "Value"]}
              rows={built.cdnra.map((x) => [x.ctin, x.ont_num, x.ont_dt, x.nt_num, x.nt_dt, money(x.val)])} />
          )}

          <SectionTable title={`HSN — B2B (${built.hsn_b2b.length}) — Supplies to registered persons`} headers={["HSN", "UQC", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST", "Total"]}
            rows={built.hsn_b2b.map((h) => [h.hsn_sc, h.uqc, h.qty, `${h.rt}%`, money(h.txval), money(h.iamt), money(h.camt), money(h.samt), money(h.val)])} />

          <SectionTable title={`HSN — B2C (${built.hsn_b2c.length}) — Supplies to unregistered persons`} headers={["HSN", "UQC", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST", "Total"]}
            rows={built.hsn_b2c.map((h) => [h.hsn_sc, h.uqc, h.qty, `${h.rt}%`, money(h.txval), money(h.iamt), money(h.camt), money(h.samt), money(h.val)])} />

          <SectionTable title={`Documents Issued (${built.docs.length})`} headers={["Type", "From", "To", "Total", "Cancelled", "Net"]}
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

function SectionTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 font-medium">{title}</div>
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No records.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h, i) => (
                  <TableHead key={i} className={i >= 3 ? "text-right" : ""}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className={`${j >= 3 ? "text-right font-mono" : "font-mono text-xs"}`}>{c}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
