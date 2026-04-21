import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/gstr3b")({
  head: () => ({ meta: [{ title: "GSTR-3B Summary — Reports" }] }),
  component: GSTR3B,
});

interface VRow {
  voucher_type: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

function GSTR3B() {
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<VRow[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("vouchers")
      .select("voucher_type, subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise")
      .eq("company_id", activeCompanyId)
      .in("voucher_type", ["sales", "purchase", "credit_note", "debit_note"])
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .then(({ data }) => setRows((data || []) as VRow[]));
  }, [activeCompanyId, from, to]);

  const sumByType = (t: string) => rows
    .filter((x) => x.voucher_type === t)
    .reduce((s, x) => ({
      sub: s.sub + x.subtotal_paise,
      cgst: s.cgst + x.cgst_paise,
      sgst: s.sgst + x.sgst_paise,
      igst: s.igst + x.igst_paise,
    }), { sub: 0, cgst: 0, sgst: 0, igst: 0 });

  const sales = sumByType("sales");
  const cn = sumByType("credit_note");
  const purchase = sumByType("purchase");
  const dn = sumByType("debit_note");

  // Output tax = sales - credit notes (returns reduce output)
  const out = {
    sub: sales.sub - cn.sub,
    cgst: sales.cgst - cn.cgst,
    sgst: sales.sgst - cn.sgst,
    igst: sales.igst - cn.igst,
  };
  // Input tax = purchase - debit notes
  const inp = {
    sub: purchase.sub - dn.sub,
    cgst: purchase.cgst - dn.cgst,
    sgst: purchase.sgst - dn.sgst,
    igst: purchase.igst - dn.igst,
  };
  const net = {
    cgst: out.cgst - inp.cgst,
    sgst: out.sgst - inp.sgst,
    igst: out.igst - inp.igst,
  };
  const totalPayable = net.cgst + net.sgst + net.igst;

  const body: (string | number)[][] = [
    ["", "Taxable Value", "CGST", "SGST", "IGST"],
    ["Outward (Sales − Credit Notes)", (out.sub/100).toFixed(2), (out.cgst/100).toFixed(2), (out.sgst/100).toFixed(2), (out.igst/100).toFixed(2)],
    ["Inward / ITC (Purchase − Debit Notes)", (inp.sub/100).toFixed(2), (inp.cgst/100).toFixed(2), (inp.sgst/100).toFixed(2), (inp.igst/100).toFixed(2)],
    ["Net GST Payable", "", (net.cgst/100).toFixed(2), (net.sgst/100).toFixed(2), (net.igst/100).toFixed(2)],
    ["Total Payable", "", "", "", (totalPayable/100).toFixed(2)],
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={() => downloadCsv(`gstr3b-${from}_to_${to}.csv`, body)}
            onExportXlsx={() => downloadXlsx(`gstr3b-${from}_to_${to}.xlsx`, [{ name: "GSTR-3B", rows: body }])}
            onExportPdf={() =>
              downloadPdfTable({
                title: "GSTR-3B Summary",
                subtitle: `${from} to ${to}`,
                head: [["", "Taxable", "CGST", "SGST", "IGST"]],
                body: [
                  ["Outward (Sales − Credit Notes)", r(out.sub).toFixed(2), r(out.cgst).toFixed(2), r(out.sgst).toFixed(2), r(out.igst).toFixed(2)],
                  ["Inward / ITC (Purchase − Debit Notes)", r(inp.sub).toFixed(2), r(inp.cgst).toFixed(2), r(inp.sgst).toFixed(2), r(inp.igst).toFixed(2)],
                  ["Net GST Payable", "", r(net.cgst).toFixed(2), r(net.sgst).toFixed(2), r(net.igst).toFixed(2)],
                ],
                foot: [["Total Payable", "", "", "", r(totalPayable).toFixed(2)]],
                fileName: `gstr3b-${from}_to_${to}.pdf`,
                rightAlignCols: [1, 2, 3, 4],
              })
            }
            onPrint={() => window.print()}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Outward Supplies (Sales − Credit Notes)</TableCell>
                <TableCell className="text-right font-mono">{formatINR(out.sub)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(out.cgst)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(out.sgst)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(out.igst)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Input Tax Credit (Purchase − Debit Notes)</TableCell>
                <TableCell className="text-right font-mono">{formatINR(inp.sub)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(inp.cgst)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(inp.sgst)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(inp.igst)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">Net GST Payable</TableCell>
                <TableCell></TableCell>
                <TableCell className={`text-right font-mono font-semibold ${net.cgst < 0 ? "text-primary" : ""}`}>{formatINR(net.cgst)}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${net.sgst < 0 ? "text-primary" : ""}`}>{formatINR(net.sgst)}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${net.igst < 0 ? "text-primary" : ""}`}>{formatINR(net.igst)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">Total Payable</TableCell>
                <TableCell colSpan={3}></TableCell>
                <TableCell className={`text-right font-mono font-semibold ${totalPayable < 0 ? "text-primary" : ""}`}>{formatINR(totalPayable)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {totalPayable < 0 && (
            <div className="border-t bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
              Negative net = Input Tax Credit exceeds Output Tax → carry forward as ITC.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
