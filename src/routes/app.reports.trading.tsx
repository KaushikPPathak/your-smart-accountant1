import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { amountHeader } from "@/lib/export-format";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { openLedgerReport } from "@/lib/voucher-return";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { fetchLedgerBalances, fetchLedgerModeSplits, type LedgerBalance, type ModeSplit } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";
import { groupBalances, groupedTRows, groupedExportRows } from "@/lib/report-grouping";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { BucketedGrid } from "@/components/reports/BucketedGrid";
import { Label } from "@/components/ui/label";
import { readItems, readVouchers, readVoucherItemsForCompany, withCacheFallback } from "@/lib/offline/cache-read";
import { calculateWac, type ItemMove } from "@/lib/inventory/valuation-engine";


export const Route = createFileRoute("/app/reports/trading")({
  head: () => ({ meta: [{ title: "Trading Account — Reports" }] }),
  component: TradingAccount,
});

function TradingAccount() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [balances, setBalances] = useState<LedgerBalance[]>([]);
  const [openingStock, setOpeningStock] = useState(0);
  const [closingStock, setClosingStock] = useState(0);
  const [modeSplits, setModeSplits] = useState<Map<string, ModeSplit>>(new Map());
  const { view, setView } = useReportView("trading");

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from, {
      excludeProfitLossClosingTransfers: true,
    }).then(setBalances);
    fetchLedgerModeSplits(activeCompanyId, from, to, {
      excludeProfitLossClosingTransfers: true,
    }).then(setModeSplits).catch(() => setModeSplits(new Map()));
  }, [activeCompanyId, from, to]);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [items, vouchers, voucherItems] = await Promise.all([
        withCacheFallback(
          async () => (await supabase.from("items").select("*").eq("company_id", activeCompanyId)).data || [],
          async () => readItems(activeCompanyId)
        ),
        withCacheFallback(
          async () => (await supabase.from("vouchers").select("*").eq("company_id", activeCompanyId).lte("voucher_date", to)).data || [],
          async () => readVouchers(activeCompanyId, { to })
        ),
        withCacheFallback(
          async () => (await supabase.from("voucher_items").select("*, vouchers!inner(voucher_date, company_id)").eq("vouchers.company_id", activeCompanyId).lte("vouchers.voucher_date", to)).data || [],
          async () => readVoucherItemsForCompany(activeCompanyId)
        )
      ]);

      const voucherMap = new Map((vouchers as any[]).map(v => [String(v.id), v]));
      let totalOpeningPaise = 0;
      let totalClosingPaise = 0;

      for (const it of items as any[]) {
        const itemMoves: ItemMove[] = (voucherItems as any[])
          .filter(vi => String(vi.item_id) === String(it.id))
          .map(vi => {
            const v = voucherMap.get(String(vi.voucher_id));
            if (!v || v.is_deleted) return null;
            if (v.voucher_date > to) return null;
            return {
              date: v.voucher_date,
              qty: Number(vi.qty || 0),
              taxablePaise: Number(vi.taxable_paise || 0),
              type: v.voucher_type,
              voucherId: v.id
            };
          })
          .filter((m): m is ItemMove => m !== null);

        const valOpening = calculateWac(
          Number(it.opening_stock_qty || 0),
          Number(it.opening_stock_rate_paise || 0),
          itemMoves.filter(m => m.date < from)
        );
        totalOpeningPaise += valOpening.closingValuePaise;

        const valClosing = calculateWac(
          Number(it.opening_stock_qty || 0),
          Number(it.opening_stock_rate_paise || 0),
          itemMoves
        );
        totalClosingPaise += valClosing.closingValuePaise;
      }

      // Check for manual overrides for both opening and closing dates if they fall in the same company
      const [{ data: manualOpening }, { data: manualClosing }] = await Promise.all([
        supabase.from("inventory_manual_valuations").select("valuation_paise").eq("company_id", activeCompanyId).eq("as_of_date", from).maybeSingle(),
        supabase.from("inventory_manual_valuations").select("valuation_paise").eq("company_id", activeCompanyId).eq("as_of_date", to).maybeSingle()
      ]);

      setOpeningStock(manualOpening ? Number(manualOpening.valuation_paise) : totalOpeningPaise);
      setClosingStock(manualClosing ? Number(manualClosing.valuation_paise) : totalClosingPaise);
    })();

  }, [activeCompanyId, from, to]);

  // Inner mode-split (Cash vs Bank/Cheque) per direct ledger.
  const innerDr = (b: LedgerBalance) => {
    const m = modeSplits.get(b.id); if (!m) return undefined;
    return [
      { label: "Paid in Cash", valuePaise: m.cashPaise },
      { label: "Paid via Bank / Cheque", valuePaise: m.bankPaise },
      { label: "Other (journal / adjustment)", valuePaise: m.otherPaise },
    ];
  };
  const innerCr = (b: LedgerBalance) => {
    const m = modeSplits.get(b.id); if (!m) return undefined;
    return [
      { label: "Received in Cash", valuePaise: -m.cashPaise },
      { label: "Received via Bank / Cheque", valuePaise: -m.bankPaise },
      { label: "Other (journal / adjustment)", valuePaise: -m.otherPaise },
    ];
  };

  // Direct income (Sales / Direct Income) and direct expenses (Purchase / Direct Exp), grouped.
  const drBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "expense_direct"),
      "TRADING",
      (b) => b.closing_paise,
      innerDr,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, modeSplits],
  );
  const crBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "income_direct"),
      "TRADING",
      (b) => -b.closing_paise,
      innerCr,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, modeSplits],
  );

  const goLedger = (id: string) =>
    openLedgerReport(navigate, { ledgerId: id, from, to });

  const drGroup = groupedTRows(drBuckets, goLedger);
  const crGroup = groupedTRows(crBuckets, goLedger);

  const totalSales = crGroup.totalPaise;
  const totalDirect = drGroup.totalPaise;
  const gp = totalSales + closingStock - (totalDirect + openingStock);

  // Build display rows with Opening Stock / Closing Stock additions.
  const drRows: TRow[] = [];
  if (openingStock) drRows.push({ label: "To Opening Stock", amount: formatINR(openingStock), emphasis: "bold" });
  drRows.push(...drGroup.rows);
  if (gp > 0) drRows.push({ label: "To Gross Profit c/d", amount: formatINR(gp), emphasis: "total" });

  const crRows: TRow[] = [...crGroup.rows];
  if (closingStock) crRows.push({ label: "By Closing Stock", amount: formatINR(closingStock), emphasis: "bold" });
  if (gp < 0) crRows.push({ label: "By Gross Loss c/d", amount: formatINR(-gp), emphasis: "total" });

  const grandLeft = openingStock + totalDirect + Math.max(0, gp);
  const grandRight = totalSales + closingStock + Math.max(0, -gp);

  // Exports
  const drExp = groupedExportRows(drBuckets, "To ");
  const crExp = groupedExportRows(crBuckets, "By ");
  if (openingStock) drExp.unshift({ label: "To Opening Stock", paise: openingStock, isSubtotal: true });
  if (closingStock) crExp.push({ label: "By Closing Stock", paise: closingStock, isSubtotal: true });
  if (gp > 0) drExp.push({ label: "  To Gross Profit c/d", paise: gp, isSubtotal: true });
  if (gp < 0) crExp.push({ label: "  By Gross Loss c/d", paise: -gp, isSubtotal: true });

  const fmtInner = (row?: { paise: number; outerPaise?: number; isHeader?: boolean }) =>
    row && !row.isHeader && row.outerPaise === undefined && row.paise !== 0 ? r(row.paise).toFixed(2) : "";
  const fmtOuter = (row?: { paise: number; outerPaise?: number; isHeader?: boolean }) =>
    row && !row.isHeader && row.outerPaise !== undefined ? r(row.outerPaise).toFixed(2) : "";

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(drExp.length, crExp.length);
    return Array.from({ length: max }).map((_, i) => [
      drExp[i]?.label ?? "",
      fmtInner(drExp[i]),
      fmtOuter(drExp[i]),
      crExp[i]?.label ?? "",
      fmtInner(crExp[i]),
      fmtOuter(crExp[i]),
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`Trading A/c: ${from} to ${to}`, "", "", "", "", ""],
    ["Dr. Particulars", "", amountHeader(), "Cr. Particulars", "", amountHeader()],
    ...exportBody(),
    ["Total", "", r(grandLeft).toFixed(2), "Total", "", r(grandRight).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`trading-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () => downloadXlsx(`trading-${from}_to_${to}.xlsx`, [{ name: "Trading", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Trading Account",
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `${from} to ${to}`,
      head: [["Dr. Particulars", "", amountHeader(), "Cr. Particulars", "", amountHeader()]],
      body: exportBody(),
      foot: [["Total", "", r(grandLeft).toFixed(2), "Total", "", r(grandRight).toFixed(2)]],
      fileName: `trading-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [1, 2, 4, 5],
    });

  return (
    <ReportViewer
      title="Trading Account"
      fromDate={from}
      toDate={to}
      onExportPdf={onExportPdf}
    >
      <Card className="print:hidden">
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={onExportCsv}
            onExportXlsx={onExportXlsx}
            onExportPdf={onExportPdf}
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
            extra={<div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Sales, Purchases &amp; Direct Expenses grouped per IT-norms. Gross Profit / Loss flows to the P&amp;L account.
            Inventory values are calculated using Weighted Average Cost (WAC) or manual overrides.
          </p>
          {(openingStock < 0 || closingStock < 0) && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <strong>Negative Stock Warning:</strong> Inventory valuation is negative. This affects Gross Profit and indicates missing purchase records.
            </div>
          )}

        </CardContent>
      </Card>
      {view === "grid" ? (
        <Card><CardContent className="p-3">
          <BucketedGrid
            reportId="trading"
            onLedgerClick={goLedger}
            sides={[
              {
                side: "Dr. Particulars",
                buckets: drBuckets,
                extras: [
                  ...(openingStock ? [{ group: "Stock", name: "Opening Stock", valuePaise: openingStock }] : []),
                  ...(gp > 0 ? [{ group: "Result", name: "Gross Profit c/d", valuePaise: gp }] : []),
                ],
              },
              {
                side: "Cr. Particulars",
                buckets: crBuckets,
                extras: [
                  ...(closingStock ? [{ group: "Stock", name: "Closing Stock", valuePaise: closingStock }] : []),
                  ...(gp < 0 ? [{ group: "Result", name: "Gross Loss c/d", valuePaise: -gp }] : []),
                ],
              },
            ]}
          />
        </CardContent></Card>
      ) : (
      <TAccount
        title="Trading Account"
        subtitle={`for the period ${from} to ${to}`}
        leftRows={drRows}
        rightRows={crRows}
        leftTotal={formatINR(grandLeft)}
        rightTotal={formatINR(grandRight)}
      />
      )}
    </ReportViewer>
  );
}
