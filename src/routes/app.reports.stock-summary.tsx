import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { downloadCsv } from "@/lib/csv";
import { amountHeader } from "@/lib/export-format";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { ManualValuationDialog } from "@/components/inventory/ManualValuationDialog";
import { Scale } from "lucide-react";
import {
  readItems,
  readVouchers,
  readVoucherItemsForCompany,
  withCacheFallback,
} from "@/lib/offline/cache-read";
import { calculateWac, VALUATION_METHODS, type ItemMove as WacMove, type ValuationMethod } from "@/lib/inventory/valuation-engine";
import { getValuationMethod, setValuationMethod } from "@/lib/inventory/valuation-method";
import { getManualValuation } from "@/lib/offline/manual-valuation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";



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
  const r = (p: number) => p / 100;
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<ItemMove[]>([]);
  const { view, setView } = useReportView("stock-summary");
  const [method, setMethod] = useState<ValuationMethod>("average");

  useEffect(() => {
    if (!activeCompanyId) return;
    getValuationMethod(activeCompanyId).then(setMethod).catch(() => setMethod("average"));
  }, [activeCompanyId]);

  const chooseMethod = (next: ValuationMethod) => {
    setMethod(next);
    if (activeCompanyId) {
      setValuationMethod(activeCompanyId, next).catch((e) => console.error("Could not save valuation method", e));
    }
  };

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
            .eq("vouchers.company_id", activeCompanyId).is("vouchers.deleted_at", null)
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
  //          + physical stock excess (qty > 0)
  // Outward = sales + debit_note (purchase return) + manufacturing consumption (qty < 0)
  //          + physical stock shortage (qty < 0)
  const isInward = (t: string) => t === "purchase" || t === "credit_note";
  const isOutward = (t: string) => t === "sales" || t === "debit_note";
  const isMfg = (t: string) => t === "manufacturing";

  const rows = useMemo(() => {
    return items.map((it) => {
      const itemMoves = moves.filter((m) => m.item_id === it.id);
      
      const wacMoves: WacMove[] = itemMoves.map(m => ({
        date: m.vouchers?.voucher_date ?? "",
        qty: Number(m.qty),
        taxablePaise: Number(m.taxable_paise),
        type: m.vouchers?.voucher_type ?? "",
        voucherId: m.voucher_id
      }));

      const val = calculateWac(
        Number(it.opening_stock_qty),
        Number(it.opening_stock_rate_paise),
        wacMoves.filter(m => m.date <= to),
        method,
      );

      return {
        ...it,
        opening: Number(it.opening_stock_qty),
        inWindow: itemMoves.filter(m => m.vouchers && m.vouchers.voucher_date >= from && m.vouchers.voucher_date <= to && (isInward(m.vouchers.voucher_type) || (m.vouchers.voucher_type === "physical_stock" && Number(m.qty) > 0))).reduce((s, m) => s + Math.abs(Number(m.qty)), 0),
        outWindow: itemMoves.filter(m => m.vouchers && m.vouchers.voucher_date >= from && m.vouchers.voucher_date <= to && (isOutward(m.vouchers.voucher_type) || (m.vouchers.voucher_type === "physical_stock" && Number(m.qty) < 0))).reduce((s, m) => s + Math.abs(Number(m.qty)), 0),

        closing: val.closingQty,
        // Negative stock has no value on hand; it is not counted until the missing purchases or opening stock are entered.
        stockValue: val.closingQty < 0 ? 0 : val.closingValuePaise,
        lowStock: it.reorder_level > 0 && val.closingQty <= it.reorder_level,
        isNegative: val.closingQty < 0,
        needsReview: val.needsReview,
      };
    });
  }, [items, moves, from, to, method]);
  
  const [manualValOpen, setManualValOpen] = useState(false);
  const [manualTotalValue, setManualTotalValue] = useState<number | null>(null);

  const fetchManualValuation = useEffect(() => {
    if (!activeCompanyId) return;
    getManualValuation(activeCompanyId, to).then((v) => setManualTotalValue(v));
  }, [activeCompanyId, to]);

  const financialYear = useMemo(() => {
    const y = new Date(from).getFullYear();
    const shortEnd = String(y + 1).slice(-2);
    return `FY ${y}-${shortEnd}`;
  }, [from]);



  const calculatedTotalValue = rows.reduce((s, r2) => s + r2.stockValue, 0);
  const totalValue = manualTotalValue !== null ? manualTotalValue : calculatedTotalValue;


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

  const onExportPdf = () =>
    downloadPdfTable({
      title: "Stock Summary",
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `As on ${to} (movement window: ${from} to ${to})`,
      head: [["Item", "HSN", "Unit", "Opening", "Inward", "Outward", "Closing", amountHeader("Value")]],
      body: rows.map((x) => [x.name, x.hsn_code ?? "", x.unit, String(x.opening), String(x.inWindow), x.outWindow ? `-${x.outWindow}` : "0", String(x.closing), r(x.stockValue).toFixed(2)]),
      foot: [["TOTAL", "", "", "", "", "", "", r(totalValue).toFixed(2)]],
      fileName: `stock-summary-${to}.pdf`,
      orientation: "l",
      rightAlignCols: [3, 4, 5, 6, 7],
    });

  return (
    <ReportViewer
      title="Stock Summary"
      asOf={to}
      onExportPdf={onExportPdf}
    >
      <Card className="print:hidden">
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={() => downloadCsv(`stock-summary-${to}.csv`, csv())}
            onExportXlsx={() => downloadXlsx(`stock-summary-${to}.xlsx`, [{ name: "Stock", rows: csv() }])}
            onExportPdf={onExportPdf}
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
            extraButtons={
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setManualValOpen(true)}
                className={manualTotalValue !== null ? "border-primary text-primary hover:text-primary" : ""}
              >
                <Scale className="mr-2 h-4 w-4" />
                {manualTotalValue !== null ? "Manual Override" : "Manual Valuation"}
              </Button>

            }
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">Stock valuation method</span>
            <Select value={method} onValueChange={(v) => chooseMethod(v as ValuationMethod)}>
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUATION_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {VALUATION_METHODS.find((m) => m.value === method)?.hint}
            </span>
          </div>
          {rows.some(r => r.needsReview) && (
            <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <strong>Check purchase rates:</strong> Some items have stock on hand but their purchase values add up to less than nothing. Their value is shown as zero until the purchase rates are corrected.
            </div>
          )}
          {rows.some(r => r.closing < 0) && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <strong>Negative Stock Detected:</strong> Some items have sales/outwards recorded before matching purchases. Their quantity is shown as is, but their value is not counted in stock value until the missing purchases or opening stock are entered.
            </div>
          )}
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
                    <TableCell className="text-right text-destructive">{x.outWindow ? `-${x.outWindow}` : "0"}</TableCell>
                    <TableCell className="text-right font-semibold">{x.closing}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(x.stockValue)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={7} className="text-right font-semibold">
                    {manualTotalValue !== null ? "Total Stock Value (Manual Override)" : "Total Stock Value"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totalValue)}</TableCell>

                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <ManualValuationDialog
        open={manualValOpen}
        onOpenChange={setManualValOpen}
        companyId={activeCompanyId || ""}
        asOfDate={to}
        financialYear={financialYear}
        calculatedWacPaise={calculatedTotalValue}
        onSuccess={() => {
          // Force refresh manual value state
          if (activeCompanyId) {
            getManualValuation(activeCompanyId, to).then((v) => setManualTotalValue(v));
          }
        }}
      />
    </ReportViewer>

  );
}
