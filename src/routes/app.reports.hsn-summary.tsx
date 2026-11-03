import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";
import { readItemRowsLocal, readItemMovesLocal } from "@/lib/offline/stock-moves-local";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { amountHeader } from "@/lib/export-format";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";

export const Route = createFileRoute("/app/reports/hsn-summary")({
  head: () => ({ meta: [{ title: "HSN-wise Stock Movement — Reports" }] }),
  component: HsnSummary,
});

interface Item {
  id: string;
  name: string;
  unit: string;
  hsn_code: string | null;
  gst_rate: number;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
}

interface Move {
  qty: number;
  rate_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  item_id: string;
  vouchers: { voucher_type: string; voucher_date: string; company_id: string } | null;
}

function HsnSummary() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);

  // Items and movements come from this PC's books, so the report works offline.
  useEffect(() => {
    if (!activeCompanyId) return;
    readItemRowsLocal(activeCompanyId)
      .then((rows) => setItems(rows.sort((a, b) => (a.hsn_code ?? "").localeCompare(b.hsn_code ?? ""))))
      .catch((e) => { console.error("HSN summary: items", e); setItems([]); });
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    readItemMovesLocal(activeCompanyId, { to })
      .then((rows) => setMoves(rows as unknown as Move[]))
      .catch((e) => { console.error("HSN summary: movements", e); setMoves([]); });
  }, [activeCompanyId, to]);

  const isPurchase = (t: string) => t === "purchase" || t === "credit_note";
  const isSale = (t: string) => t === "sales" || t === "debit_note";
  const isMfg = (t: string) => t === "manufacturing";

  const rows = useMemo(() => {
    return items.map((it) => {
      const valRate = Number(it.opening_stock_rate_paise) || 0; // paise per unit (standard cost)
      const itemMoves = moves.filter((m) => m.item_id === it.id);

      const sumQty = (pred: (m: Move) => boolean) =>
        itemMoves.filter(pred).reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
      const sumTaxable = (pred: (m: Move) => boolean) =>
        itemMoves.filter(pred).reduce((s, m) => s + Number(m.taxable_paise || 0), 0);
      const sumTax = (pred: (m: Move) => boolean) =>
        itemMoves.filter(pred).reduce(
          (s, m) => s + Number(m.cgst_paise || 0) + Number(m.sgst_paise || 0) + Number(m.igst_paise || 0),
          0,
        );

      const before = (m: Move) => !!m.vouchers && m.vouchers.voucher_date < from;
      const within = (m: Move) =>
        !!m.vouchers && m.vouchers.voucher_date >= from && m.vouchers.voucher_date <= to;
      const inward = (m: Move) =>
        !!m.vouchers && (isPurchase(m.vouchers.voucher_type) || (isMfg(m.vouchers.voucher_type) && Number(m.qty) > 0));
      const outward = (m: Move) =>
        !!m.vouchers && (isSale(m.vouchers.voucher_type) || (isMfg(m.vouchers.voucher_type) && Number(m.qty) < 0));

      const openingQty = Number(it.opening_stock_qty) + sumQty((m) => before(m) && inward(m)) - sumQty((m) => before(m) && outward(m));
      const openingValue = Math.round(openingQty * valRate);

      const purchaseQty = sumQty((m) => within(m) && inward(m));
      const purchaseValue = sumTaxable((m) => within(m) && inward(m));
      const purchaseTax = sumTax((m) => within(m) && inward(m));
      const purchaseInvoice = purchaseValue + purchaseTax;
      const saleQty = sumQty((m) => within(m) && outward(m));
      const saleValue = sumTaxable((m) => within(m) && outward(m));
      const saleTax = sumTax((m) => within(m) && outward(m));
      const saleInvoice = saleValue + saleTax;

      const closingQty = openingQty + purchaseQty - saleQty;
      const closingValue = Math.round(closingQty * valRate);

      return {
        id: it.id,
        name: it.name,
        hsn: it.hsn_code || "—",
        unit: it.unit,
        gst_rate: Number(it.gst_rate) || 0,
        openingQty, openingValue,
        purchaseQty, purchaseValue, purchaseTax, purchaseInvoice,
        saleQty, saleValue, saleTax, saleInvoice,
        closingQty, closingValue,
      };
    });
  }, [items, moves, from, to]);

  type RowVm = (typeof rows)[number];

  const totals = useMemo(() => rows.reduce(
    (a, x) => ({
      openingValue: a.openingValue + x.openingValue,
      purchaseValue: a.purchaseValue + x.purchaseValue,
      purchaseTax: a.purchaseTax + x.purchaseTax,
      purchaseInvoice: a.purchaseInvoice + x.purchaseInvoice,
      saleValue: a.saleValue + x.saleValue,
      saleTax: a.saleTax + x.saleTax,
      saleInvoice: a.saleInvoice + x.saleInvoice,
      closingValue: a.closingValue + x.closingValue,
    }),
    { openingValue: 0, purchaseValue: 0, purchaseTax: 0, purchaseInvoice: 0, saleValue: 0, saleTax: 0, saleInvoice: 0, closingValue: 0 },
  ), [rows]);

  const gridColumns: DGColumn<RowVm>[] = useMemo(() => [
    { id: "hsn", header: "HSN", type: "text", width: 110, accessor: (x) => x.hsn, groupable: true },
    { id: "name", header: "Item", type: "text", width: 220, accessor: (x) => x.name },
    { id: "unit", header: "Unit", type: "enum", width: 70, accessor: (x) => x.unit, groupable: true },
    { id: "gst", header: "GST %", type: "number", width: 70, align: "right", accessor: (x) => x.gst_rate },
    { id: "openQ", header: "Opening Qty", type: "number", width: 110, align: "right", accessor: (x) => x.openingQty, aggregator: "sum" },
    { id: "openV", header: "Opening Val", type: "number", width: 130, align: "right", accessor: (x) => x.openingValue / 100, cell: (x) => formatINR(x.openingValue), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "purQ", header: "Purchase Qty", type: "number", width: 110, align: "right", accessor: (x) => x.purchaseQty, aggregator: "sum" },
    { id: "purV", header: "Purchase Taxable", type: "number", width: 140, align: "right", accessor: (x) => x.purchaseValue / 100, cell: (x) => formatINR(x.purchaseValue), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "purT", header: "Purchase Tax", type: "number", width: 130, align: "right", accessor: (x) => x.purchaseTax / 100, cell: (x) => formatINR(x.purchaseTax), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "purI", header: "Purchase Invoice", type: "number", width: 140, align: "right", accessor: (x) => x.purchaseInvoice / 100, cell: (x) => formatINR(x.purchaseInvoice), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "salQ", header: "Sales Qty", type: "number", width: 110, align: "right", accessor: (x) => x.saleQty, aggregator: "sum" },
    { id: "salV", header: "Sales Taxable", type: "number", width: 140, align: "right", accessor: (x) => x.saleValue / 100, cell: (x) => formatINR(x.saleValue), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "salT", header: "Sales Tax", type: "number", width: 130, align: "right", accessor: (x) => x.saleTax / 100, cell: (x) => formatINR(x.saleTax), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "salI", header: "Sales Invoice", type: "number", width: 140, align: "right", accessor: (x) => x.saleInvoice / 100, cell: (x) => formatINR(x.saleInvoice), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    { id: "closQ", header: "Closing Qty", type: "number", width: 110, align: "right", accessor: (x) => x.closingQty, aggregator: "sum" },
    { id: "closV", header: "Closing Val", type: "number", width: 130, align: "right", accessor: (x) => x.closingValue / 100, cell: (x) => formatINR(x.closingValue), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
  ], []);

  const p2 = (n: number) => (n / 100).toFixed(2);
  const csv = (): (string | number)[][] => [
    [`HSN-wise Stock Movement — ${from} to ${to}`],
    ["HSN", "Item", "Unit", "GST%", "Opening Qty", "Opening Value", "Purchase Qty", "Purchase Taxable", "Purchase Tax", "Purchase Invoice", "Sales Qty", "Sales Taxable", "Sales Tax", "Sales Invoice", "Closing Qty", "Closing Value"],
    ...rows.map((x) => [x.hsn, x.name, x.unit, x.gst_rate, x.openingQty, p2(x.openingValue), x.purchaseQty, p2(x.purchaseValue), p2(x.purchaseTax), p2(x.purchaseInvoice), x.saleQty, p2(x.saleValue), p2(x.saleTax), p2(x.saleInvoice), x.closingQty, p2(x.closingValue)]),
    ["TOTAL", "", "", "", "", p2(totals.openingValue), "", p2(totals.purchaseValue), p2(totals.purchaseTax), p2(totals.purchaseInvoice), "", p2(totals.saleValue), p2(totals.saleTax), p2(totals.saleInvoice), "", p2(totals.closingValue)],
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
            onExportCsv={() => downloadCsv(`hsn-summary-${from}-to-${to}.csv`, csv())}
            onExportXlsx={() => downloadXlsx(`hsn-summary-${from}-to-${to}.xlsx`, [{ name: "HSN Summary", rows: csv() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title: "HSN-wise Stock Movement",
                companyName: pdfHeader.companyName,
                companySubLine: pdfHeader.companySubLine,
                subtitle: `${from} to ${to}`,
                head: [["HSN", "Item", "Unit", "GST%", "Open Qty", amountHeader("Open Val"), "Pur Qty", amountHeader("Pur Tax'ble"), amountHeader("Pur Tax"), amountHeader("Pur Invoice"), "Sale Qty", amountHeader("Sale Tax'ble"), amountHeader("Sale Tax"), amountHeader("Sale Invoice"), "Close Qty", amountHeader("Close Val")]],
                body: rows.map((x) => [x.hsn, x.name, x.unit, String(x.gst_rate), String(x.openingQty), r(x.openingValue).toFixed(2), String(x.purchaseQty), r(x.purchaseValue).toFixed(2), r(x.purchaseTax).toFixed(2), r(x.purchaseInvoice).toFixed(2), String(x.saleQty), r(x.saleValue).toFixed(2), r(x.saleTax).toFixed(2), r(x.saleInvoice).toFixed(2), String(x.closingQty), r(x.closingValue).toFixed(2)]),
                foot: [["TOTAL", "", "", "", "", r(totals.openingValue).toFixed(2), "", r(totals.purchaseValue).toFixed(2), r(totals.purchaseTax).toFixed(2), r(totals.purchaseInvoice).toFixed(2), "", r(totals.saleValue).toFixed(2), r(totals.saleTax).toFixed(2), r(totals.saleInvoice).toFixed(2), "", r(totals.closingValue).toFixed(2)]],
                fileName: `hsn-summary-${from}-to-${to}.pdf`,
                orientation: "l",
                rightAlignCols: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
              })
            }
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Grouped by HSN by default. Purchase/Sales columns show Taxable, Tax (CGST+SGST+IGST) and Invoice value (taxable + tax) — so totals reconcile with GSTR-1 HSN summary. Opening &amp; Closing value use each item's standard rate (opening rate). Inward = Purchase + Sales Return + Manufacturing output; Outward = Sales + Purchase Return + Manufacturing consumption.
          </p>

        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <DataGrid
            reportId="hsn-summary"
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
