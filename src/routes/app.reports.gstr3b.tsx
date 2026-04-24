import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileJson, Printer } from "lucide-react";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadXlsx } from "@/lib/exporters";
import {
  buildGstr3B, fetchVouchers, fetchCompanyMeta, gstr3bToJson, gstr3bToXlsxSheets,
  monthRange, periodFP, downloadJson, fetchInwardSummary, fetchItcReversal, validateGstr3B,
  type CompanyMeta, type BuiltGstr3B, type InwardSummaryRow, type ItcReversalRow,
} from "@/lib/gst-returns";
import { ValidationPanel } from "@/components/reports/ValidationPanel";

export const Route = createFileRoute("/app/reports/gstr3b")({
  head: () => ({ meta: [{ title: "GSTR-3B — Reports" }] }),
  component: GSTR3BPage,
});

const monthsOfYear = (year: number) => {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names.map((n, i) => ({ value: `${year}-${String(i + 1).padStart(2, "0")}`, label: `${n} ${year}` }));
};

function GSTR3BPage() {
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const fyYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  const [month, setMonth] = useState<string>(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [built, setBuilt] = useState<BuiltGstr3B | null>(null);

  const period = useMemo(() => {
    const r = monthRange(month);
    return { ...r, fp: periodFP(r.from) };
  }, [month]);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => setCompany(await fetchCompanyMeta(activeCompanyId)))();
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId || !company) return;
    (async () => {
      const [sales, purchases, creditNotes, debitNotes] = await Promise.all([
        fetchVouchers(activeCompanyId, period.from, period.to, ["sales"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["purchase"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["credit_note"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["debit_note"]),
      ]);
      setBuilt(buildGstr3B({ company, from: period.from, to: period.to, fp: period.fp, sales, purchases, creditNotes, debitNotes }));
    })();
  }, [activeCompanyId, company, period.from, period.to, period.fp]);

  const fileBase = `GSTR3B_${company?.gstin || "GSTIN"}_${period.fp}`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Return period</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[fyYear, fyYear + 1].flatMap((y) => monthsOfYear(y)).map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" disabled={!built}
                onClick={() => built && downloadXlsx(`${fileBase}.xlsx`, gstr3bToXlsxSheets(built))}>
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel Summary
              </Button>
              <Button variant="outline" size="sm" disabled={!built}
                onClick={() => built && downloadJson(`${fileBase}.json`, gstr3bToJson(built))}>
                <FileJson className="mr-1 h-4 w-4" /> GSTN JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Period: <strong>{period.from}</strong> to <strong>{period.to}</strong> · FP <code>{period.fp}</code></p>
        </CardContent>
      </Card>

      {built && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">3.1 Outward & inward supplies on RCM</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nature of Supplies</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">Cess</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <Sup row={["(a) Outward taxable (other than zero rated, nil rated, exempted)", built.sup_details.osup_det]} />
                  <Sup row={["(b) Outward zero-rated", built.sup_details.osup_zero]} />
                  <Sup row={["(c) Other outward (nil/exempt)", built.sup_details.osup_nil_exmp]} />
                  <Sup row={["(d) Inward — reverse charge", built.sup_details.isup_rev]} />
                  <Sup row={["(e) Non-GST outward", built.sup_details.osup_nongst]} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">3.2 Inter-state to Unregistered (from 3.1(a))</div>
              {built.inter_sup.unreg_details.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No inter-state B2C supplies in this period.</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>POS</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {built.inter_sup.unreg_details.map((p) => (
                      <TableRow key={p.pos}>
                        <TableCell className="font-mono">{p.pos}</TableCell>
                        <TableCell className="text-right font-mono">{moneyR(p.txval)}</TableCell>
                        <TableCell className="text-right font-mono">{moneyR(p.iamt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">4. Eligible ITC</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>(A) ITC Available — All other ITC</TableCell>
                    <TableCell className="text-right font-mono">{moneyR(built.itc_elg.itc_avl[0].iamt)}</TableCell>
                    <TableCell className="text-right font-mono">{moneyR(built.itc_elg.itc_avl[0].camt)}</TableCell>
                    <TableCell className="text-right font-mono">{moneyR(built.itc_elg.itc_avl[0].samt)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">(C) Net ITC Available</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.iamt)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.camt)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.samt)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">6.1 Payment of Tax</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Tax Payable</TableHead>
                  <TableHead className="text-right">Net cash payable</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>Integrated Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.iamt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.iamt_payable)}</TableCell></TableRow>
                  <TableRow><TableCell>Central Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.camt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.camt_payable)}</TableCell></TableRow>
                  <TableRow><TableCell>State/UT Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.samt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.samt_payable)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function moneyR(v: number) { return formatINR(Math.round(v * 100)); }

function Sup({ row }: { row: [string, { txval: number; iamt: number; camt: number; samt: number; csamt: number }] }) {
  const [label, s] = row;
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.txval)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.iamt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.camt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.samt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.csamt)}</TableCell>
    </TableRow>
  );
}
