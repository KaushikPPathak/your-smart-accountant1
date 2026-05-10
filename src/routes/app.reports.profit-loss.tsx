import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { groupBalances, groupedTRows, groupedExportRows } from "@/lib/report-grouping";
import { getEntityFeatures } from "@/lib/entity-status";
import { openLedgerReport } from "@/lib/voucher-return";

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
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [balances, setBalances] = useState<LedgerBalance[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from).then(setBalances);
  }, [activeCompanyId, from, to]);

  // Use ONLY ledgers whose group is in the PL section (Indirect Income / Indirect Expenses)
  const expenseBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "expense_indirect"),
      "PL",
      (b) => b.closing_paise,
    ),
    [balances],
  );
  const incomeBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => b.type === "income_indirect"),
      "PL",
      (b) => -b.closing_paise,
    ),
    [balances],
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
    [dr, "Amount (₹)", cr, "Amount (₹)"],
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
      head: [[dr, "Amount (₹)", cr, "Amount (₹)"]],
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
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {isIE
              ? <>Income &amp; Expenditure for the period — surplus/deficit transfers to the <strong>Corpus / General Fund</strong>.</>
              : <>Indirect Income &amp; Indirect Expenses, grouped per IT-norms. Gross Profit/Loss flows in from the <strong>Trading Account</strong>.</>}
          </p>
        </CardContent>
      </Card>
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
    </div>
  );
}
