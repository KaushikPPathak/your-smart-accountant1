import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { amountHeader } from "@/lib/export-format";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { fetchLedgerBalancesWithMeta, type LedgerBalance } from "@/lib/reports";
import { groupBalances, groupedTRows, groupedExportRows } from "@/lib/report-grouping";
import { getEntityFeatures } from "@/lib/entity-status";
import { openLedgerReport } from "@/lib/voucher-return";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { BucketedGrid } from "@/components/reports/BucketedGrid";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";
import { TaxAuditPanel } from "@/components/reports/TaxAuditPanel";

export const Route = createFileRoute("/app/reports/profit-loss")({
  head: () => ({ meta: [{ title: "Profit & Loss — Reports" }] }),
  component: ProfitLoss,
});

function ProfitLoss() {
  const { activeCompanyId, activeMembership } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const features = getEntityFeatures(activeMembership?.companies?.entity_status ?? "individual");
  const isIE = features.plLabel === "Income & Expenditure A/c";
  const reportTitle = isIE ? "Income & Expenditure Account" : "Profit & Loss Account";
  const dr = isIE ? "Expenditure" : "Dr. Particulars";
  const cr = isIE ? "Income" : "Cr. Particulars";
  const surplusLabel = isIE ? "To Excess of Income over Expenditure" : "To Net Profit c/d";
  const deficitLabel = isIE ? "By Excess of Expenditure over Income" : "By Net Loss c/d";
  // When inventory is disabled the Trading Account is not the primary flow, so
  // direct income (Sales, Job Work) and direct expense (Purchases, Factory
  // Wages) must appear in P&L — otherwise those ledgers silently disappear
  // from every profitability report.
  const inventoryEnabled = !!activeMembership?.companies?.inventory_enabled;
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const { view, setView } = useReportView("profit-loss");
  const [taxView, setTaxView] = useState(false);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);
  const [excludedClosingEntries, setExcludedClosingEntries] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalancesWithMeta(activeCompanyId, to, from, {
      excludeProfitLossClosingTransfers: true,
    }).then((result) => {
      setBalances(result.balances);
      setExcludedClosingEntries(result.excludedClosingTransferEntries);
    });
  }, [activeCompanyId, from, to]);

  const expenseTypes = inventoryEnabled
    ? new Set(["expense_indirect"])
    : new Set(["expense_direct", "expense_indirect"]);
  const incomeTypes = inventoryEnabled
    ? new Set(["income_indirect"])
    : new Set(["income_direct", "income_indirect"]);

  // Direct income/expense ledgers default to TRADING-section groups
  // (SALES_ACCOUNTS / PURCHASE_ACCOUNTS / DIRECT_EXPENSES / DIRECT_INCOMES).
  // When inventory is off, the Trading A/c is not the primary flow, so we
  // must also pull those TRADING buckets into the P&L — otherwise Job Work
  // Income and Factory Wages get silently dropped by groupBalances().
  const plSections: ("PL" | "TRADING")[] = inventoryEnabled ? ["PL"] : ["PL", "TRADING"];
  const expenseBuckets = useMemo(
    () => plSections.flatMap((sec) => groupBalances(
      balances.filter((b) => expenseTypes.has(b.type)),
      sec,
      (b) => b.closing_paise,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, inventoryEnabled],
  );
  const incomeBuckets = useMemo(
    () => plSections.flatMap((sec) => groupBalances(
      balances.filter((b) => incomeTypes.has(b.type)),
      sec,
      (b) => -b.closing_paise,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, inventoryEnabled],
  );

  const goLedger = (id: string) =>
    openLedgerReport(navigate, { ledgerId: id, from, to });

  const exp = groupedTRows(expenseBuckets, goLedger);
  const inc = groupedTRows(incomeBuckets, goLedger);

  const profit = inc.totalPaise - exp.totalPaise;

  const expenseRows: TRow[] = [...exp.rows];
  const incomeRows: TRow[] = [...inc.rows];
  if (profit > 0) expenseRows.push({ label: surplusLabel, amount: formatINR(profit), emphasis: "bold" });
  if (profit < 0) incomeRows.push({ label: deficitLabel, amount: formatINR(-profit), emphasis: "bold" });

  const grandLeft = exp.totalPaise + Math.max(0, profit);
  const grandRight = inc.totalPaise + Math.max(0, -profit);

  // Exports
  const drExp = groupedExportRows(expenseBuckets, isIE ? "" : "To ");
  const crExp = groupedExportRows(incomeBuckets, isIE ? "" : "By ");
  if (profit > 0) drExp.push({ label: `  ${surplusLabel}`, paise: profit, isSubtotal: true });
  if (profit < 0) crExp.push({ label: `  ${deficitLabel}`, paise: -profit, isSubtotal: true });

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
    [`${reportTitle}: ${from} to ${to}`, "", "", ""],
    [dr, amountHeader(), cr, amountHeader()],
    ...exportBody(),
    ["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)],
  ];

  const fileSlug = isIE ? "income-expenditure" : "profit-loss";
  const onExportCsv = () => downloadCsv(`${fileSlug}-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`${fileSlug}-${from}_to_${to}.xlsx`, [{ name: isIE ? "I&E" : "P&L", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: reportTitle,
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `${from} to ${to}`,
      head: [[dr, amountHeader(), cr, amountHeader()]],
      body: exportBody(),
      foot: [["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)]],
      fileName: `${fileSlug}-${from}_to_${to}.pdf`,
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
            extra={<div className="flex gap-3 items-end">
              <div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>
              <div className="space-y-1"><Label className="text-xs">Tax Audit</Label>
                <Button size="sm" variant={taxView ? "default" : "outline"} onClick={() => setTaxView((v) => !v)}>
                  <Scale className="mr-1 h-3.5 w-3.5" />{taxView ? "On" : "Off"}
                </Button>
              </div>
            </div>}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {isIE
              ? <>Income &amp; Expenditure for the period — surplus/deficit transfers to the <strong>Corpus / General Fund</strong>.</>
              : inventoryEnabled
                ? <>Indirect Income &amp; Indirect Expenses only. Sales / Purchase / Direct Expenses (e.g. Factory Wages) flow through the <strong>Trading Account</strong> as Gross Profit / Loss.</>
                : <>All Income &amp; Expenses for the period (Direct + Indirect). Enable Inventory in Company settings to split Sales / Purchases / Direct Expenses into a separate <strong>Trading Account</strong>.</>}
          </p>
          {excludedClosingEntries > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Year-end Profit &amp; Loss transfer entries are excluded here so the period income and expenses remain visible.
            </p>
          )}
        </CardContent>
      </Card>
      {view === "grid" ? (
        <Card><CardContent className="p-3">
          <BucketedGrid
            reportId="profit-loss"
            onLedgerClick={goLedger}
            sides={[
              {
                side: dr,
                buckets: expenseBuckets,
                extras: profit > 0 ? [{ group: "Result", name: surplusLabel, valuePaise: profit }] : [],
              },
              {
                side: cr,
                buckets: incomeBuckets,
                extras: profit < 0 ? [{ group: "Result", name: deficitLabel, valuePaise: -profit }] : [],
              },
            ]}
          />
        </CardContent></Card>
      ) : (
      <TAccount
        title={reportTitle}
        subtitle={`for the period ${from} to ${to}`}
        leftHeader={dr}
        rightHeader={cr}
        leftRows={expenseRows}
        rightRows={incomeRows}
        leftTotal={formatINR(grandLeft)}
        rightTotal={formatINR(grandRight)}
      />
      )}
      {taxView && <TaxAuditPanel mode="pl" fyStart={from} fyEnd={to} />}
    </div>
  );
}
