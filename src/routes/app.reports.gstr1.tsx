import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/gstr1")({
  head: () => ({ meta: [{ title: "GSTR-1 Summary — Reports" }] }),
  component: GSTR1,
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
  ledgers: { name: string; gstin: string | null; state_code: string | null } | null;
  voucher_items: { qty: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; gst_rate: number; items: { hsn_code: string | null } | null }[];
}

function GSTR1() {
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<VRow[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("vouchers")
      .select("id, voucher_date, voucher_number, subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, ledgers:party_ledger_id(name, gstin, state_code), voucher_items(qty, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate, items:item_id(hsn_code))")
      .eq("company_id", activeCompanyId)
      .eq("voucher_type", "sales")
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: true })
      .then(({ data }) => setRows((data || []) as unknown as VRow[]));
  }, [activeCompanyId, from, to]);

  const b2b = rows.filter((x) => x.ledgers?.gstin);
  const b2c = rows.filter((x) => !x.ledgers?.gstin);

  const sumOf = (list: VRow[]) =>
    list.reduce(
      (s, x) => ({
        sub: s.sub + x.subtotal_paise,
        cgst: s.cgst + x.cgst_paise,
        sgst: s.sgst + x.sgst_paise,
        igst: s.igst + x.igst_paise,
        total: s.total + x.total_paise,
      }),
      { sub: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
    );
  const tB2B = sumOf(b2b);
  const tB2C = sumOf(b2c);

  const hsn = useMemo(() => {
    const map = new Map<string, { hsn: string; rate: number; qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const v of rows) {
      for (const it of v.voucher_items || []) {
        const key = `${it.items?.hsn_code || "—"}|${it.gst_rate}`;
        const cur = map.get(key) ?? { hsn: it.items?.hsn_code || "—", rate: it.gst_rate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
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

  const exportSheets = () =>
    downloadXlsx(`gstr1-${from}_to_${to}.xlsx`, [
      {
        name: "B2B",
        rows: [
          ["GSTIN", "Party", "Invoice", "Date", "Place", "Taxable", "CGST", "SGST", "IGST", "Total"],
          ...b2b.map((x) => [x.ledgers?.gstin ?? "", x.ledgers?.name ?? "", x.voucher_number, x.voucher_date, x.ledgers?.state_code ?? "", r(x.subtotal_paise), r(x.cgst_paise), r(x.sgst_paise), r(x.igst_paise), r(x.total_paise)]),
        ],
      },
      {
        name: "B2C",
        rows: [
          ["Invoice", "Date", "Taxable", "CGST", "SGST", "IGST", "Total"],
          ...b2c.map((x) => [x.voucher_number, x.voucher_date, r(x.subtotal_paise), r(x.cgst_paise), r(x.sgst_paise), r(x.igst_paise), r(x.total_paise)]),
        ],
      },
      {
        name: "HSN",
        rows: [
          ["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
          ...hsn.map((h) => [h.hsn, h.rate, h.qty, r(h.taxable), r(h.cgst), r(h.sgst), r(h.igst)]),
        ],
      },
    ]);

  const csv = (): (string | number)[][] => [
    [`GSTR-1 Summary: ${from} to ${to}`],
    [],
    ["B2B (Registered)"],
    ["GSTIN", "Party", "Invoice", "Date", "Place", "Taxable", "CGST", "SGST", "IGST", "Total"],
    ...b2b.map((x) => [x.ledgers?.gstin ?? "", x.ledgers?.name ?? "", x.voucher_number, x.voucher_date, x.ledgers?.state_code ?? "", (x.subtotal_paise/100).toFixed(2), (x.cgst_paise/100).toFixed(2), (x.sgst_paise/100).toFixed(2), (x.igst_paise/100).toFixed(2), (x.total_paise/100).toFixed(2)]),
    ["TOTAL", "", "", "", "", (tB2B.sub/100).toFixed(2), (tB2B.cgst/100).toFixed(2), (tB2B.sgst/100).toFixed(2), (tB2B.igst/100).toFixed(2), (tB2B.total/100).toFixed(2)],
    [],
    ["B2C (Unregistered)"],
    ["Invoice", "Date", "Taxable", "CGST", "SGST", "IGST", "Total"],
    ...b2c.map((x) => [x.voucher_number, x.voucher_date, (x.subtotal_paise/100).toFixed(2), (x.cgst_paise/100).toFixed(2), (x.sgst_paise/100).toFixed(2), (x.igst_paise/100).toFixed(2), (x.total_paise/100).toFixed(2)]),
    ["TOTAL", "", (tB2C.sub/100).toFixed(2), (tB2C.cgst/100).toFixed(2), (tB2C.sgst/100).toFixed(2), (tB2C.igst/100).toFixed(2), (tB2C.total/100).toFixed(2)],
    [],
    ["HSN Summary"],
    ["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
    ...hsn.map((h) => [h.hsn, h.rate, h.qty, (h.taxable/100).toFixed(2), (h.cgst/100).toFixed(2), (h.sgst/100).toFixed(2), (h.igst/100).toFixed(2)]),
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
            onExportCsv={() => downloadCsv(`gstr1-${from}_to_${to}.csv`, csv())}
            onExportXlsx={exportSheets}
            onExportPdf={() =>
              downloadPdfTable({
                title: "GSTR-1 — B2B",
                subtitle: `${from} to ${to}`,
                head: [["GSTIN", "Party", "Invoice", "Date", "Place", "Taxable", "CGST", "SGST", "IGST", "Total"]],
                body: b2b.map((x) => [x.ledgers?.gstin ?? "", x.ledgers?.name ?? "", x.voucher_number, x.voucher_date, x.ledgers?.state_code ?? "", r(x.subtotal_paise).toFixed(2), r(x.cgst_paise).toFixed(2), r(x.sgst_paise).toFixed(2), r(x.igst_paise).toFixed(2), r(x.total_paise).toFixed(2)]),
                foot: [["TOTAL", "", "", "", "", r(tB2B.sub).toFixed(2), r(tB2B.cgst).toFixed(2), r(tB2B.sgst).toFixed(2), r(tB2B.igst).toFixed(2), r(tB2B.total).toFixed(2)]],
                fileName: `gstr1-b2b-${from}_to_${to}.pdf`,
                orientation: "l",
                rightAlignCols: [5, 6, 7, 8, 9],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">B2B uses parties with GSTIN; B2C are unregistered. HSN summary aggregates all sales.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 font-medium">B2B (Registered)</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GSTIN</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b2b.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-mono text-xs">{x.ledgers?.gstin}</TableCell>
                  <TableCell>{x.ledgers?.name}</TableCell>
                  <TableCell className="font-mono text-xs">{x.voucher_number}</TableCell>
                  <TableCell>{x.voucher_date}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.subtotal_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.cgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.sgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.igst_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(x.total_paise)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} className="text-right font-semibold">TOTAL</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2B.sub)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2B.cgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2B.sgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2B.igst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2B.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 font-medium">B2C (Unregistered)</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b2c.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-mono text-xs">{x.voucher_number}</TableCell>
                  <TableCell>{x.voucher_date}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.subtotal_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.cgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.sgst_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(x.igst_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(x.total_paise)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2} className="text-right font-semibold">TOTAL</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2C.sub)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2C.cgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2C.sgst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2C.igst)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(tB2C.total)}</TableCell>
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
