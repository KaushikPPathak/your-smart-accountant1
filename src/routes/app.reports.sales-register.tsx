import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/sales-register")({
  head: () => ({ meta: [{ title: "Sales Register — Reports" }] }),
  component: () => <Register kind="sales" />,
});

interface VRow {
  id: string;
  voucher_date: string;
  voucher_number: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: { name: string; gstin: string | null } | null;
  voucher_items: { qty: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; gst_rate: number; items: { hsn_code: string | null; name: string } | null }[];
}

export function Register({ kind }: { kind: "sales" | "purchase" }) {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<VRow[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("vouchers")
      .select("id, voucher_date, voucher_number, subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, ledgers:party_ledger_id(name, gstin), voucher_items(qty, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate, items:item_id(hsn_code, name))")
      .eq("company_id", activeCompanyId)
      .eq("voucher_type", kind)
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: true })
      .then(({ data }) => setRows((data || []) as unknown as VRow[]));
  }, [activeCompanyId, from, to, kind]);

  const totals = useMemo(() => rows.reduce(
    (s, x) => ({
      sub: s.sub + x.subtotal_paise,
      cgst: s.cgst + x.cgst_paise,
      sgst: s.sgst + x.sgst_paise,
      igst: s.igst + x.igst_paise,
      total: s.total + x.total_paise,
    }),
    { sub: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
  ), [rows]);

  // HSN summary
  const hsn = useMemo(() => {
    const map = new Map<string, { hsn: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number; rate: number }>();
    for (const v of rows) {
      for (const it of v.voucher_items || []) {
        const key = `${it.items?.hsn_code || "—"}|${it.gst_rate}`;
        const cur = map.get(key) ?? { hsn: it.items?.hsn_code || "—", qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, rate: it.gst_rate };
        cur.qty += Number(it.qty);
        cur.taxable += it.taxable_paise;
        cur.cgst += it.cgst_paise;
        cur.sgst += it.sgst_paise;
        cur.igst += it.igst_paise;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.hsn.localeCompare(b.hsn));
  }, [rows]);

  const title = kind === "sales" ? "Sales Register" : "Purchase Register";
  const slug = kind === "sales" ? "sales-register" : "purchase-register";

  const head = ["Date", "Number", "Party", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Total"];
  const body = (): (string | number)[][] => [
    head,
    ...rows.map((x) => [
      x.voucher_date,
      x.voucher_number,
      x.ledgers?.name ?? "",
      x.ledgers?.gstin ?? "",
      (x.subtotal_paise / 100).toFixed(2),
      (x.cgst_paise / 100).toFixed(2),
      (x.sgst_paise / 100).toFixed(2),
      (x.igst_paise / 100).toFixed(2),
      (x.total_paise / 100).toFixed(2),
    ]),
    ["TOTAL", "", "", "", (totals.sub / 100).toFixed(2), (totals.cgst / 100).toFixed(2), (totals.sgst / 100).toFixed(2), (totals.igst / 100).toFixed(2), (totals.total / 100).toFixed(2)],
    [],
    ["HSN Summary"],
    ["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
    ...hsn.map((h) => [h.hsn, h.rate, h.qty, (h.taxable / 100).toFixed(2), (h.cgst / 100).toFixed(2), (h.sgst / 100).toFixed(2), (h.igst / 100).toFixed(2)]),
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
            onExportCsv={() => downloadCsv(`${slug}-${from}_to_${to}.csv`, body())}
            onExportXlsx={() => downloadXlsx(`${slug}-${from}_to_${to}.xlsx`, [
              { name: title, rows: body() },
              { name: "HSN Summary", rows: [["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"], ...hsn.map((h) => [h.hsn, h.rate, h.qty, r(h.taxable), r(h.cgst), r(h.sgst), r(h.igst)])] },
            ])}
            onExportPdf={() =>
              downloadPdfTable({
                title,
                subtitle: `${from} to ${to}`,
                head: [head],
                body: rows.map((x) => [
                  x.voucher_date,
                  x.voucher_number,
                  x.ledgers?.name ?? "",
                  x.ledgers?.gstin ?? "",
                  r(x.subtotal_paise).toFixed(2),
                  r(x.cgst_paise).toFixed(2),
                  r(x.sgst_paise).toFixed(2),
                  r(x.igst_paise).toFixed(2),
                  r(x.total_paise).toFixed(2),
                ]),
                foot: [["TOTAL", "", "", "", r(totals.sub).toFixed(2), r(totals.cgst).toFixed(2), r(totals.sgst).toFixed(2), r(totals.igst).toFixed(2), r(totals.total).toFixed(2)]],
                fileName: `${slug}-${from}_to_${to}.pdf`,
                orientation: "l",
                rightAlignCols: [4, 5, 6, 7, 8],
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
                <TableHead>Date</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((x) => (
                <TableRow
                  key={x.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: x.id } })}
                  title="Click to edit"
                >
                  <TableCell>{x.voucher_date}</TableCell>
                  <TableCell className="font-mono text-xs">{x.voucher_number}</TableCell>
                  <TableCell>{x.ledgers?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{x.ledgers?.gstin ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.subtotal_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.cgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.sgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.igst_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(x.total_paise)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} className="text-right font-semibold">TOTAL</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.sub)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.cgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.sgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.igst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 font-medium">HSN Summary</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Rate %</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hsn.map((h, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{h.hsn}</TableCell>
                  <TableCell className="text-right">{h.rate}%</TableCell>
                  <TableCell className="text-right">{h.qty}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.taxable)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.cgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.sgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.igst)}</TableCell>
                </TableRow>
              ))}
              {hsn.length === 0 && (
                <TableRow><TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">No items in range.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
