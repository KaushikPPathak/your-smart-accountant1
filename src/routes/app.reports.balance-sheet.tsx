import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { fetchLedgerBalances, type LedgerBalance } from "@/lib/reports";
import {
  groupBalances,
  groupedTRows,
  groupedExportRows,
} from "@/lib/report-grouping";
import { getEntityFeatures } from "@/lib/entity-status";

export const Route = createFileRoute("/app/reports/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet — Reports" }] }),
  component: BalanceSheet,
});

function BalanceSheet() {
  const { activeCompanyId, activeMembership } = useCompany();
  const features = getEntityFeatures(activeMembership?.companies?.entity_status ?? "individual");
  const liabHeader = features.scheduleIII
    ? "Equity & Liabilities"
    : `Liabilities (${features.capitalLabel} & Sources of Funds)`;
  const assetHeader = features.scheduleIII ? "Assets" : "Assets (Application of Funds)";
  const profitLabelPos = features.plLabel === "Income & Expenditure A/c"
    ? "Excess of Income over Expenditure"
    : "Net Profit (current period)";
  const profitLabelNeg = features.plLabel === "Income & Expenditure A/c"
    ? "Excess of Expenditure over Income"
    : "Net Loss (current period)";
  const navigate = useNavigate();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to).then(setBalances);
  }, [activeCompanyId, to]);

  // Period P/L flows into the BS to balance it (Net Profit on Liabilities, Loss on Assets).
  const profitPaise = useMemo(() => {
    const inc = balances.filter((b) => b.type === "income_direct" || b.type === "income_indirect")
      .reduce((s, b) => s + -b.closing_paise, 0);
    const exp = balances.filter((b) => b.type === "expense_direct" || b.type === "expense_indirect")
      .reduce((s, b) => s + b.closing_paise, 0);
    return inc - exp;
  }, [balances]);

  const liabBuckets = useMemo(
    () => groupBalances(balances, "BS_LIAB", (b) => -b.closing_paise),
    [balances],
  );
  const assetBuckets = useMemo(
    () => groupBalances(balances, "BS_ASSET", (b) => b.closing_paise),
    [balances],
  );

  const goLedger = (id: string) =>
    navigate({ to: "/app/reports/ledger", search: { ledgerId: id, from, to } });

  const liab = groupedTRows(liabBuckets, goLedger);
  const asset = groupedTRows(assetBuckets, goLedger);

  // Append P/L balancing row
  const liabRows: TRow[] = [...liab.rows];
  const assetRows: TRow[] = [...asset.rows];
  if (profitPaise > 0) {
    liabRows.push({ label: profitLabelPos, amount: formatINR(profitPaise), emphasis: "bold" });
  } else if (profitPaise < 0) {
    assetRows.push({ label: profitLabelNeg, amount: formatINR(-profitPaise), emphasis: "bold" });
  }
  const grandL = liab.totalPaise + Math.max(0, profitPaise);
  const grandA = asset.totalPaise + Math.max(0, -profitPaise);
  const diffPaise = grandA - grandL;

  // Exports
  const liabExp = groupedExportRows(liabBuckets);
  const assetExp = groupedExportRows(assetBuckets);
  if (profitPaise > 0) liabExp.push({ label: profitLabelPos, paise: profitPaise, isSubtotal: true });
  if (profitPaise < 0) assetExp.push({ label: profitLabelNeg, paise: -profitPaise, isSubtotal: true });

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(liabExp.length, assetExp.length);
    return Array.from({ length: max }).map((_, i) => [
      liabExp[i]?.label ?? "",
      liabExp[i] && !liabExp[i].isHeader ? r(liabExp[i].paise).toFixed(2) : "",
      assetExp[i]?.label ?? "",
      assetExp[i] && !assetExp[i].isHeader ? r(assetExp[i].paise).toFixed(2) : "",
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`Balance Sheet as on ${to}`, "", "", ""],
    [liabHeader, "Amount (₹)", assetHeader, "Amount (₹)"],
    ...exportBody(),
    ["Total", r(grandL).toFixed(2), "Total", r(grandA).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`balance-sheet-${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`balance-sheet-${to}.xlsx`, [{ name: "Balance Sheet", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Balance Sheet",
      subtitle: `As on ${to}`,
      head: [[liabHeader, "Amount (₹)", assetHeader, "Amount (₹)"]],
      body: exportBody(),
      foot: [["Total", r(grandL).toFixed(2), "Total", r(grandA).toFixed(2)]],
      fileName: `balance-sheet-${to}.pdf`,
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
            Closing position as on <strong>{to}</strong>. Heads grouped per Income-Tax / Schedule III norms
            (Capital, Reserves, Loans, Sundry Creditors, Duties &amp; Taxes, Current Liabilities;
            Fixed Assets, Investments, Stock, Debtors, Cash, Bank, Loans &amp; Advances, Current Assets).
          </p>
          <div
            className={`mt-2 flex items-center justify-between rounded border px-3 py-2 text-sm ${
              diffPaise === 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            <span className="font-medium">
              {diffPaise === 0 ? "Balance Sheet is tallied" : "Difference in Balance Sheet"}
            </span>
            <span className="font-mono">
              {diffPaise === 0
                ? formatINR(0)
                : `${formatINR(Math.abs(diffPaise))} ${diffPaise > 0 ? "(Assets > Liabilities)" : "(Liabilities > Assets)"}`}
            </span>
          </div>
        </CardContent>
      </Card>
      <TAccount
        title="Balance Sheet"
        subtitle={`as on ${to}`}
        leftHeader={liabHeader}
        rightHeader={assetHeader}
        leftRows={liabRows}
        rightRows={assetRows}
        leftTotal={formatINR(grandL)}
        rightTotal={formatINR(grandA)}
      />
    </div>
  );
}
