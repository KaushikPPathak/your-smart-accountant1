import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { amountHeader } from "@/lib/export-format";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";

export const Route = createFileRoute("/app/reports/itc-item-wise")({
  head: () => ({ meta: [{ title: "Item-wise ITC — Reports" }] }),
  component: ItcItemWise,
});

interface Item {
  id: string;
  name: string;
  unit: string;
  hsn_code: string | null;
  gst_rate: number;
}

interface Line {
  item_id: string;
  qty: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  vouchers: { voucher_type: string; voucher_date: string; company_id: string } | null;
}

function ItcItemWise() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("items")
      .select("id, name, unit, hsn_code, gst_rate")
      .eq("company_id", activeCompanyId)
      .order("name")
      .then(({ data }) => setItems((data || []) as Item[]));
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("voucher_items")
      .select(
        "item_id, qty, taxable_paise, cgst_paise, sgst_paise, igst_paise, vouchers!inner(voucher_type, voucher_date, company_id)",
      )
      .eq("vouchers.company_id", activeCompanyId)
      .gte("vouchers.voucher_date", from)
      .lte("vouchers.voucher_date", to)
      .then(({ data }) => setLines((data || []) as unknown as Line[]));
  }, [activeCompanyId, from, to]);

  const rows = useMemo(() => {
    const isPurchase = (t: string) => t === "purchase";
    const isPurReturn = (t: string) => t === "debit_note";
    const isSale = (t: string) => t === "sales";
    const isSaleReturn = (t: string) => t === "credit_note";

    return items
      .map((it) => {
        const ls = lines.filter((l) => l.item_id === it.id);
        const acc = {
          purQty: 0, purTaxable: 0, availCgst: 0, availSgst: 0, availIgst: 0,
          salQty: 0, salTaxable: 0, outCgst: 0, outSgst: 0, outIgst: 0,
        };
        for (const l of ls) {
          const t = l.vouchers?.voucher_type || "";
          const cgst = Number(l.cgst_paise) || 0;
          const sgst = Number(l.sgst_paise) || 0;
          const igst = Number(l.igst_paise) || 0;
          const tax = Number(l.taxable_paise) || 0;
          const qty = Math.abs(Number(l.qty) || 0);
          if (isPurchase(t)) {
            acc.purQty += qty; acc.purTaxable += tax;
            acc.availCgst += cgst; acc.availSgst += sgst; acc.availIgst += igst;
          } else if (isPurReturn(t)) {
            acc.purQty -= qty; acc.purTaxable -= tax;
            acc.availCgst -= cgst; acc.availSgst -= sgst; acc.availIgst -= igst;
          } else if (isSale(t)) {
            acc.salQty += qty; acc.salTaxable += tax;
            acc.outCgst += cgst; acc.outSgst += sgst; acc.outIgst += igst;
          } else if (isSaleReturn(t)) {
            acc.salQty -= qty; acc.salTaxable -= tax;
            acc.outCgst -= cgst; acc.outSgst -= sgst; acc.outIgst -= igst;
          }
        }
        const availed = acc.availCgst + acc.availSgst + acc.availIgst;
        const spent = acc.outCgst + acc.outSgst + acc.outIgst;
        return {
          id: it.id,
          name: it.name,
          hsn: it.hsn_code || "—",
          unit: it.unit,
          gst_rate: Number(it.gst_rate) || 0,
          ...acc,
          availed,
          spent,
          net: availed - spent,
        };
      })
      .filter((x) => x.availed !== 0 || x.spent !== 0);
  }, [items, lines]);

  type RowVm = (typeof rows)[number];

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, x) => ({
          purTaxable: a.purTaxable + x.purTaxable,
          availCgst: a.availCgst + x.availCgst,
          availSgst: a.availSgst + x.availSgst,
          availIgst: a.availIgst + x.availIgst,
          availed: a.availed + x.availed,
          salTaxable: a.salTaxable + x.salTaxable,
          outCgst: a.outCgst + x.outCgst,
          outSgst: a.outSgst + x.outSgst,
          outIgst: a.outIgst + x.outIgst,
          spent: a.spent + x.spent,
          net: a.net + x.net,
        }),
        {
          purTaxable: 0, availCgst: 0, availSgst: 0, availIgst: 0, availed: 0,
          salTaxable: 0, outCgst: 0, outSgst: 0, outIgst: 0, spent: 0, net: 0,
        },
      ),
    [rows],
  );

  const gridColumns: DGColumn<RowVm>[] = useMemo(
    () => [
      { id: "hsn", header: "HSN", type: "text", width: 100, accessor: (x) => x.hsn, groupable: true },
      { id: "name", header: "Item", type: "text", width: 220, accessor: (x) => x.name },
      { id: "unit", header: "Unit", type: "enum", width: 70, accessor: (x) => x.unit, groupable: true },
      { id: "gst", header: "GST %", type: "number", width: 70, align: "right", accessor: (x) => x.gst_rate },
      { id: "purT", header: "Purchase Taxable", type: "number", width: 140, align: "right", accessor: (x) => x.purTaxable / 100, cell: (x) => formatINR(x.purTaxable), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aCgst", header: "ITC CGST", type: "number", width: 110, align: "right", accessor: (x) => x.availCgst / 100, cell: (x) => formatINR(x.availCgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aSgst", header: "ITC SGST", type: "number", width: 110, align: "right", accessor: (x) => x.availSgst / 100, cell: (x) => formatINR(x.availSgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aIgst", header: "ITC IGST", type: "number", width: 110, align: "right", accessor: (x) => x.availIgst / 100, cell: (x) => formatINR(x.availIgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aTot", header: "ITC Availed", type: "number", width: 130, align: "right", accessor: (x) => x.availed / 100, cell: (x) => formatINR(x.availed), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "salT", header: "Sales Taxable", type: "number", width: 140, align: "right", accessor: (x) => x.salTaxable / 100, cell: (x) => formatINR(x.salTaxable), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oCgst", header: "Output CGST", type: "number", width: 120, align: "right", accessor: (x) => x.outCgst / 100, cell: (x) => formatINR(x.outCgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oSgst", header: "Output SGST", type: "number", width: 120, align: "right", accessor: (x) => x.outSgst / 100, cell: (x) => formatINR(x.outSgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oIgst", header: "Output IGST", type: "number", width: 120, align: "right", accessor: (x) => x.outIgst / 100, cell: (x) => formatINR(x.outIgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "spent", header: "ITC Utilised", type: "number", width: 130, align: "right", accessor: (x) => x.spent / 100, cell: (x) => formatINR(x.spent), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "net", header: "Net (Avail − Util)", type: "number", width: 140, align: "right", accessor: (x) => x.net / 100, cell: (x) => formatINR(x.net), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    ],
    [],
  );

  const csvRows = (): (string | number)[][] => [
    [`Item-wise ITC Availed vs Utilised — ${from} to ${to}`],
    ["HSN", "Item", "Unit", "GST%", "Purchase Taxable", "ITC CGST", "ITC SGST", "ITC IGST", "ITC Availed", "Sales Taxable", "Output CGST", "Output SGST", "Output IGST", "ITC Utilised", "Net"],
    ...rows.map((x) => [x.hsn, x.name, x.unit, x.gst_rate, (x.purTaxable / 100).toFixed(2), (x.availCgst / 100).toFixed(2), (x.availSgst / 100).toFixed(2), (x.availIgst / 100).toFixed(2), (x.availed / 100).toFixed(2), (x.salTaxable / 100).toFixed(2), (x.outCgst / 100).toFixed(2), (x.outSgst / 100).toFixed(2), (x.outIgst / 100).toFixed(2), (x.spent / 100).toFixed(2), (x.net / 100).toFixed(2)]),
    ["TOTAL", "", "", "", (totals.purTaxable / 100).toFixed(2), (totals.availCgst / 100).toFixed(2), (totals.availSgst / 100).toFixed(2), (totals.availIgst / 100).toFixed(2), (totals.availed / 100).toFixed(2), (totals.salTaxable / 100).toFixed(2), (totals.outCgst / 100).toFixed(2), (totals.outSgst / 100).toFixed(2), (totals.outIgst / 100).toFixed(2), (totals.spent / 100).toFixed(2), (totals.net / 100).toFixed(2)],
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onExportCsv={() => downloadCsv(`itc-item-wise-${from}-to-${to}.csv`, csvRows())}
            onExportXlsx={() => downloadXlsx(`itc-item-wise-${from}-to-${to}.xlsx`, [{ name: "ITC Item-wise", rows: csvRows() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title: "Item-wise ITC Availed vs Utilised",
                companyName: pdfHeader.companyName,
                companySubLine: pdfHeader.companySubLine,
                subtitle: `${from} to ${to}`,
                head: [["HSN", "Item", "Unit", "GST%", amountHeader("Pur Taxable"), amountHeader("ITC CGST"), amountHeader("ITC SGST"), amountHeader("ITC IGST"), amountHeader("ITC Availed"), amountHeader("Sale Taxable"), amountHeader("Out CGST"), amountHeader("Out SGST"), amountHeader("Out IGST"), amountHeader("ITC Util."), amountHeader("Net")]],
                body: rows.map((x) => [x.hsn, x.name, x.unit, String(x.gst_rate), r(x.purTaxable).toFixed(2), r(x.availCgst).toFixed(2), r(x.availSgst).toFixed(2), r(x.availIgst).toFixed(2), r(x.availed).toFixed(2), r(x.salTaxable).toFixed(2), r(x.outCgst).toFixed(2), r(x.outSgst).toFixed(2), r(x.outIgst).toFixed(2), r(x.spent).toFixed(2), r(x.net).toFixed(2)]),
                foot: [["TOTAL", "", "", "", r(totals.purTaxable).toFixed(2), r(totals.availCgst).toFixed(2), r(totals.availSgst).toFixed(2), r(totals.availIgst).toFixed(2), r(totals.availed).toFixed(2), r(totals.salTaxable).toFixed(2), r(totals.outCgst).toFixed(2), r(totals.outSgst).toFixed(2), r(totals.outIgst).toFixed(2), r(totals.spent).toFixed(2), r(totals.net).toFixed(2)]],
                fileName: `itc-item-wise-${from}-to-${to}.pdf`,
                orientation: "l",
                rightAlignCols: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            ITC Availed = input GST on Purchases (net of Debit Notes). ITC Utilised = output GST on Sales of the same item
            (net of Credit Notes) — i.e. the tax liability that ITC offsets when the item is sold. Net = Availed − Utilised.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <DataGrid
            reportId="itc-item-wise"
            rows={rows}
            columns={gridColumns}
            globalSearch={(x) => `${x.hsn} ${x.name} ${x.unit}`}
            height={560}
          />
        </CardContent>
      </Card>
    </div>
  );
}
