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

export const Route = createFileRoute("/app/reports/profit-loss")({
  head: () => ({ meta: [{ title: "Profit & Loss — Reports" }] }),
  component: ProfitLoss,
});

function ProfitLoss() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from).then(setBalances);
  }, [activeCompanyId, from, to]);

  const { incomes, expenses, totalInc, totalExp, profit } = useMemo(() => {
    // Exclude direct income / direct expense — those belong to Trading A/c.
    // Indirect items are P&L items.
    const incomes = balances
      .filter((b) => b.type === "income_indirect")
      .map((b) => ({ ...b, value: -b.closing_paise }));
    const expenses = balances
      .filter((b) => b.type === "expense_indirect")
      .map((b) => ({ ...b, value: b.closing_paise }));
    const totalInc = incomes.reduce((s, x) => s + x.value, 0);
    const totalExp = expenses.reduce((s, x) => s + x.value, 0);
    return { incomes, expenses, totalInc, totalExp, profit: totalInc - totalExp };
  }, [balances]);

  // T-account rows
  const expenseRows: TRow[] = expenses
    .filter((e) => e.value)
    .map((e) => ({
      label: <>To {e.name}</>,
      amount: formatINR(e.value),
      onClick: () => navigate({ to: "/app/reports/ledger", search: { ledgerId: e.id, from, to } }),
    }));
  if (profit > 0) {
    expenseRows.push({
      label: "To Net Profit c/d",
      amount: formatINR(profit),
      emphasis: "bold",
    });
  }
  const incomeRows: TRow[] = incomes
    .filter((e) => e.value)
    .map((e) => ({
      label: <>By {e.name}</>,
      amount: formatINR(e.value),
      onClick: () => navigate({ to: "/app/reports/ledger", search: { ledgerId: e.id, from, to } }),
    }));
  if (profit < 0) {
    incomeRows.push({
      label: "By Net Loss c/d",
      amount: formatINR(-profit),
      emphasis: "bold",
    });
  }
  const grandLeft = totalExp + Math.max(0, profit);
  const grandRight = totalInc + Math.max(0, -profit);

  // Plain export rows derived from source data (not JSX TRow.label).
  type ExportRow = { label: string; paise: number };
  const lExp = expenses.filter((e) => e.value);
  const lInc = incomes.filter((e) => e.value);
  const drExport: ExportRow[] = lExp.map((e) => ({ label: `To ${e.name}`, paise: e.value }));
  if (profit > 0) drExport.push({ label: "To Net Profit c/d", paise: profit });
  const crExport: ExportRow[] = lInc.map((e) => ({ label: `By ${e.name}`, paise: e.value }));
  if (profit < 0) crExport.push({ label: "By Net Loss c/d", paise: -profit });

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(drExport.length, crExport.length);
    return Array.from({ length: max }).map((_, i) => [
      drExport[i]?.label ?? "",
      drExport[i] ? r(drExport[i].paise).toFixed(2) : "",
      crExport[i]?.label ?? "",
      crExport[i] ? r(crExport[i].paise).toFixed(2) : "",
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`Profit & Loss A/c: ${from} to ${to}`, "", "", ""],
    ["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"],
    ...exportBody(),
    ["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`profit-loss-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`profit-loss-${from}_to_${to}.xlsx`, [{ name: "P&L", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Profit & Loss A/c",
      subtitle: `${from} to ${to}`,
      head: [["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"]],
      body: exportBody(),
      foot: [["Total", r(grandLeft).toFixed(2), "Total", r(grandRight).toFixed(2)]],
      fileName: `profit-loss-${from}_to_${to}.pdf`,
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
            Indirect Income & Indirect Expenses only. Gross Profit/Loss flows in from the <strong>Trading Account</strong>.
          </p>
        </CardContent>
      </Card>
      <TAccount
        title="Profit & Loss Account"
        subtitle={`for the period ${from} to ${to}`}
        leftRows={expenseRows}
        rightRows={incomeRows}
        leftTotal={formatINR(grandLeft)}
        rightTotal={formatINR(grandRight)}
      />
    </div>
  );
}
