import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { fetchLedgerBalances, type LedgerBalance } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";
import { groupBalances, groupedTRows, groupedExportRows } from "@/lib/report-grouping";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { BucketedGrid } from "@/components/reports/BucketedGrid";
import { Label } from "@/components/ui/label";

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
  const { view, setView } = useReportView("trading");

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from).then(setBalances);
  }, [activeCompanyId, from, to]);

  useEffect(() => {
    if (!activeCompanyId) return;
    Promise.all([
      supabase
        .from("ledgers")
        .select("opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", activeCompanyId)
        .eq("type", "stock_in_hand"),
      supabase
        .from("items")
        .select("opening_stock_qty, opening_stock_rate_paise")
        .eq("company_id", activeCompanyId),
    ]).then(([sLed, items]) => {
      const ledOp = ((sLed.data || []) as { opening_balance_paise: number; opening_balance_is_debit: boolean }[])
        .reduce((s, l) => s + (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise, 0);
      const itemOp = ((items.data || []) as { opening_stock_qty: number; opening_stock_rate_paise: number }[])
        .reduce((s, it) => s + Math.round(it.opening_stock_qty * it.opening_stock_rate_paise), 0);
      setOpeningStock(ledOp || itemOp);
      setClosingStock(ledOp || itemOp);
    });
  }, [activeCompanyId]);

  // Direct income (Sales / Direct Income) and direct expenses (Purchase / Direct Exp), grouped.
  const drBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "expense_direct"),
      "TRADING",
      (b) => b.closing_paise,
    ),
    [balances],
  );
  const crBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "income_direct"),
      "TRADING",
      (b) => -b.closing_paise,
    ),
    [balances],
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

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(drExp.length, crExp.length);
    return Array.from({ length: max }).map((_, i) => [
      drExp[i]?.label ?? "",
      drExp[i] && !drExp[i].isHeader ? r(drExp[i].paise).toFixed(2) : "",
      crExp[i]?.label ?? "",
      crExp[i] && !crExp[i].isHeader ? r(crExp[i].paise).toFixed(2) : "",
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`Trading A/c: ${from} to ${to}`, "", "", ""],
    ["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"],
    ...exportBody(),
    ["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`trading-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () => downloadXlsx(`trading-${from}_to_${to}.xlsx`, [{ name: "Trading", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Trading Account",
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `${from} to ${to}`,
      head: [["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"]],
      body: exportBody(),
      foot: [["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)]],
      fileName: `trading-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [1, 3],
    });

  return (
    <div className="space-y-3">
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
            onPrint={() => window.print()}
            extra={<div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Sales, Purchases &amp; Direct Expenses grouped per IT-norms. Gross Profit / Loss flows to the P&amp;L account.
            Stock values are taken from <strong>Stock-in-Hand</strong> ledgers (or items opening) — adjust closing stock manually
            via a journal entry if needed.
          </p>
        </CardContent>
      </Card>
      <TAccount
        title="Trading Account"
        subtitle={`for the period ${from} to ${to}`}
        leftRows={drRows}
        rightRows={crRows}
        leftTotal={formatINR(grandLeft)}
        rightTotal={formatINR(grandRight)}
      />
    </div>
  );
}
