import { createFileRoute } from "@tanstack/react-router";
import { amountHeader } from "@/lib/export-format";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import {
  readItems,
  readVouchers,
  readVoucherItemsForCompany,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/reports/stock-summary")({
  head: () => ({ meta: [{ title: "Stock Summary — Reports" }] }),
  component: StockSummary,
});

interface Item {
  id: string;
  name: string;
  unit: string;
  hsn_code: string | null;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
  reorder_level: number;
}

interface ItemMove {
  qty: number;
  rate_paise: number;
  taxable_paise: number;
  item_id: string;
  voucher_id: string;
  vouchers: { voucher_type: string; voucher_date: string; company_id: string } | null;
}

function StockSummary() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<ItemMove[]>([]);
  const { view, setView } = useReportView("stock-summary");

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const data = await withCacheFallback<Item[]>(
        async () => {
          const { data } = await supabase
            .from("items")
            .select("id, name, unit, hsn_code, opening_stock_qty, opening_stock_rate_paise, reorder_level")
            .eq("company_id", activeCompanyId)
            .order("name");
          return (data || []) as Item[];
        },
        async () => {
          const rows = await readItems(activeCompanyId);
          return (rows as any[]).map((i) => ({
            id: String(i.id),
            name: String(i.name ?? ""),
            unit: String(i.unit ?? ""),
            hsn_code: i.hsn_code ?? null,
            opening_stock_qty: Number(i.opening_stock_qty ?? 0),
            opening_stock_rate_paise: Number(i.opening_stock_rate_paise ?? 0),
            reorder_level: Number(i.reorder_level ?? 0),
          })) as Item[];
        },
      );
      setItems(data);
    })();
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const data = await withCacheFallback<ItemMove[]>(
        async () => {
          const { data } = await supabase
            .from("voucher_items")
            .select("qty, rate_paise, taxable_paise, item_id, voucher_id, vouchers!inner(voucher_type, voucher_date, company_id)")
            .eq("vouchers.company_id", activeCompanyId)
            .lte("vouchers.voucher_date", to);
          return (data || []) as unknown as ItemMove[];
        },
        async () => {
          const [vouchers, viRows] = await Promise.all([
            readVouchers(activeCompanyId),
            readVoucherItemsForCompany(activeCompanyId),
          ]);
          const vById = new Map((vouchers as any[]).map((v) => [String(v.id), v]));
          return (viRows as any[])
            .map((vi) => {
              const v = vById.get(String(vi.voucher_id));
              if (!v) return null;
              if (v.is_deleted === true) return null;
              const date = String(v.voucher_date ?? "");
              if (to && date > to) return null;
              return {
                qty: Number(vi.qty ?? 0),
                rate_paise: Number(vi.rate_paise ?? 0),
                taxable_paise: Number(vi.taxable_paise ?? 0),
                item_id: String(vi.item_id ?? ""),
                voucher_id: String(vi.voucher_id ?? ""),
                vouchers: {
                  voucher_type: String(v.voucher_type ?? ""),
                  voucher_date: date,
                  company_id: String(v.company_id ?? activeCompanyId),
                },
              } as ItemMove;
            })
            .filter(Boolean) as ItemMove[];
        },
      );
      setMoves(data);
    })();
  }, [activeCompanyId, to]);


  // Inward = purchase + credit_note (sales return) + manufacturing output (qty > 0)
  // Outward = sales + debit_note (purchase return) + manufacturing consumption (qty < 0)
  const isInward = (t: string) => t === "purchase" || t === "credit_note";
  const isOutward = (t: string) => t === "sales" || t === "debit_note";
  const isMfg = (t: string) => t === "manufacturing";

  const rows = useMemo(() => {
    return items.map((it) => {
      const itemMoves = moves.filter((m) => m.item_id === it.id);
      const mfgIn = (m: typeof itemMoves[number]) =>
        m.vouchers && isMfg(m.vouchers.voucher_type) && Number(m.qty) > 0;
      const mfgOut = (m: typeof itemMoves[number]) =>
        m.vouchers && isMfg(m.vouchers.voucher_type) && Number(m.qty) < 0;

      const inBefore = itemMoves
        .filter((m) => m.vouchers && m.vouchers.voucher_date < from && (isInward(m.vouchers.voucher_type) || mfgIn(m)))
        .reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
      const outBefore = itemMoves
        .filter((m) => m.vouchers && m.vouchers.voucher_date < from && (isOutward(m.vouchers.voucher_type) || mfgOut(m)))
        .reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
      const opening = Number(it.opening_stock_qty) + inBefore - outBefore;

      const inWindow = itemMoves
        .filter((m) => m.vouchers && m.vouchers.voucher_date >= from && m.vouchers.voucher_date <= to && (isInward(m.vouchers.voucher_type) || mfgIn(m)))
        .reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
      const outWindow = itemMoves
        .filter((m) => m.vouchers && m.vouchers.voucher_date >= from && m.vouchers.voucher_date <= to && (isOutward(m.vouchers.voucher_type) || mfgOut(m)))
        .reduce((s, m) => s + Math.abs(Number(m.qty)), 0);

      const closing = opening + inWindow - outWindow;
      const valuationRate = it.opening_stock_rate_paise; // simplification: use opening rate as standard cost
      const stockValue = Math.round(closing * valuationRate);
      const lowStock = it.reorder_level > 0 && closing <= it.reorder_level;
      return { ...it, opening, inWindow, outWindow, closing, stockValue, lowStock };
    });
  }, [items, moves, from, to]);

  const totalValue = rows.reduce((s, r2) => s + r2.stockValue, 0);

  // Sold / consumed quantities are shown as negative numbers so the sign
  // convention matches inventory ledgers ("goods leaving stock").
  const csv = (): (string | number)[][] => [
    [`Stock Summary as on ${to}`],
    ["Item", "HSN", "Unit", "Opening", "Inward", "Outward", "Closing", "Value"],
    ...rows.map((x) => [x.name, x.hsn_code ?? "", x.unit, x.opening, x.inWindow, -x.outWindow, x.closing, (x.stockValue/100).toFixed(2)]),
    ["TOTAL", "", "", "", "", "", "", (totalValue/100).toFixed(2)],
  ];

  type RowVm = (typeof rows)[number];
  const gridColumns: DGColumn<RowVm>[] = useMemo(() => [
    { id: "name", header: "Item", type: "text", width: 240, accessor: (x) => x.name, cell: (x) => (
      <span>{x.name}{x.lowStock && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">LOW</span>}</span>
    ) },
    { id: "hsn", header: "HSN", type: "text", width: 110, accessor: (x) => x.hsn_code ?? "", groupable: true },
    { id: "unit", header: "Unit", type: "enum", width: 80, accessor: (x) => x.unit, groupable: true },
    { id: "opening", header: "Opening", type: "number", width: 110, align: "right", accessor: (x) => x.opening, aggregator: "sum" },
    { id: "inward", header: "Inward", type: "number", width: 110, align: "right", accessor: (x) => x.inWindow, aggregator: "sum" },
    { id: "outward", header: "Outward", type: "number", width: 110, align: "right", accessor: (x) => -x.outWindow, cell: (x) => x.outWindow ? `-${x.outWindow}` : "0", aggregator: "sum" },
    { id: "closing", header: "Closing", type: "number", width: 110, align: "right", accessor: (x) => x.closing, aggregator: "sum" },
    { id: "value", header: "Value", type: "number", width: 140, align: "right", accessor: (x) => x.stockValue / 100, cell: (x) => formatINR(x.stockValue), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
  ], []);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={() => downloadCsv(`stock-summary-${to}.csv`, csv())}
            onExportXlsx={() => downloadXlsx(`stock-summary-${to}.xlsx`, [{ name: "Stock", rows: csv() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title: "Stock Summary",
                companyName: pdfHeader.companyName,
                companySubLine: pdfHeader.companySubLine,
                subtitle: `As on ${to} (movement window: ${from} to ${to})`,
                head: [["Item", "HSN", "Unit", "Opening", "Inward", "Outward", "Closing", amountHeader("Value")]],
                body: rows.map((x) => [x.name, x.hsn_code ?? "", x.unit, String(x.opening), String(x.inWindow), String(x.outWindow), String(x.closing), r(x.stockValue).toFixed(2)]),
                foot: [["TOTAL", "", "", "", "", "", "", r(totalValue).toFixed(2)]],
                fileName: `stock-summary-${to}.pdf`,
                orientation: "l",
                rightAlignCols: [3, 4, 5, 6, 7],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">Stock value is calculated using each item's opening rate.</p>
          <div className="mt-2"><ViewSwitcher view={view} onChange={setView} /></div>
        </CardContent>
      </Card>
      {view === "grid" ? (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId="stock-summary"
              rows={rows}
              columns={gridColumns}
              globalSearch={(x) => `${x.name} ${x.hsn_code ?? ""} ${x.unit}`}
              height={520}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Inward</TableHead>
                  <TableHead className="text-right">Outward</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((x) => (
                  <TableRow key={x.id} className={x.lowStock ? "bg-destructive/5" : ""}>
                    <TableCell>
                      {x.name}
                      {x.lowStock && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">LOW</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{x.hsn_code ?? "—"}</TableCell>
                    <TableCell>{x.unit}</TableCell>
                    <TableCell className="text-right">{x.opening}</TableCell>
                    <TableCell className="text-right text-primary">{x.inWindow}</TableCell>
                    <TableCell className="text-right">{x.outWindow}</TableCell>
                    <TableCell className="text-right font-semibold">{x.closing}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(x.stockValue)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={7} className="text-right font-semibold">Total Stock Value</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totalValue)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
