import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import {
  fetchLedgerBalances,
  PL_INCOME,
  PL_EXPENSE,
  BS_ASSET,
  BS_LIAB,
  type LedgerBalance,
} from "@/lib/reports";

export const Route = createFileRoute("/app/reports/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet — Reports" }] }),
  component: BalanceSheet,
});

function BalanceSheet() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to).then(setBalances);
  }, [activeCompanyId, to]);

  const { assets, liabilities, totalA, totalL, profit } = useMemo(() => {
    const assets = balances
      .filter((b) => BS_ASSET.has(b.type))
      .map((b) => ({ ...b, value: b.closing_paise }));
    const liabilities = balances
      .filter((b) => BS_LIAB.has(b.type))
      .map((b) => ({ ...b, value: -b.closing_paise }));
    const incomeTotal = balances.filter((b) => PL_INCOME.has(b.type)).reduce((s, b) => s + -b.closing_paise, 0);
    const expenseTotal = balances.filter((b) => PL_EXPENSE.has(b.type)).reduce((s, b) => s + b.closing_paise, 0);
    const profit = incomeTotal - expenseTotal;
    const totalA = assets.reduce((s, x) => s + x.value, 0);
    const totalL = liabilities.reduce((s, x) => s + x.value, 0);
    return { assets, liabilities, totalA, totalL, profit };
  }, [balances]);

  // Add net profit/loss to liability side (profit) or asset side (loss) to balance
  const liabExtended = profit >= 0
    ? [...liabilities, { id: "__pl", name: "Net Profit (current period)", type: "capital", value: profit }]
    : liabilities;
  const assetExtended = profit < 0
    ? [...assets, { id: "__pl", name: "Net Loss (current period)", type: "current_asset", value: -profit }]
    : assets;
  const grandL = totalL + Math.max(0, profit);
  const grandA = totalA + Math.max(0, -profit);

  const csvRows = (): (string | number)[][] => [
    [`Balance Sheet as on ${to}`, ""],
    ["LIABILITIES", ""],
    ...liabExtended.filter((x) => x.value).map((x) => [x.name, (x.value / 100).toFixed(2)]),
    ["Total Liabilities", (grandL / 100).toFixed(2)],
    ["", ""],
    ["ASSETS", ""],
    ...assetExtended.filter((x) => x.value).map((x) => [x.name, (x.value / 100).toFixed(2)]),
    ["Total Assets", (grandA / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`balance-sheet-${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`balance-sheet-${to}.xlsx`, [{ name: "Balance Sheet", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Balance Sheet",
      subtitle: `As on ${to}`,
      head: [["Particulars", "Amount (₹)"]],
      body: [
        ["— LIABILITIES —", ""],
        ...liabExtended.filter((x) => x.value).map((x) => [x.name, r(x.value).toFixed(2)]),
        ["Total Liabilities", r(grandL).toFixed(2)],
        ["", ""],
        ["— ASSETS —", ""],
        ...assetExtended.filter((x) => x.value).map((x) => [x.name, r(x.value).toFixed(2)]),
        ["Total Assets", r(grandA).toFixed(2)],
      ],
      fileName: `balance-sheet-${to}.pdf`,
      rightAlignCols: [1],
    });

  return (
    <div className="space-y-3">
      <Card>
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
          <p className="mt-2 text-xs text-muted-foreground">Closing position as on <strong>{to}</strong>. Net profit/loss for the period is added to balance the sheet.</p>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Liabilities</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {liabExtended.filter((x) => x.value).map((x) => (
                  <TableRow
                    key={x.id}
                    className={x.id !== "__pl" ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => x.id !== "__pl" && navigate({ to: "/app/reports/ledger", search: { ledgerId: x.id, from, to } })}
                  ><TableCell>{x.name}</TableCell><TableCell className="text-right font-mono">{formatINR(x.value)}</TableCell></TableRow>
                ))}
                <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold">{formatINR(grandL)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Assets</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {assetExtended.filter((x) => x.value).map((x) => (
                  <TableRow
                    key={x.id}
                    className={x.id !== "__pl" ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => x.id !== "__pl" && navigate({ to: "/app/reports/ledger", search: { ledgerId: x.id, from, to } })}
                  ><TableCell>{x.name}</TableCell><TableCell className="text-right font-mono">{formatINR(x.value)}</TableCell></TableRow>
                ))}
                <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold">{formatINR(grandA)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
