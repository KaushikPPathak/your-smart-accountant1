import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { fetchLedgerBalances, PL_INCOME, PL_EXPENSE, type LedgerBalance } from "@/lib/reports";

export const Route = createFileRoute("/app/reports/profit-loss")({
  head: () => ({ meta: [{ title: "Profit & Loss — Reports" }] }),
  component: ProfitLoss,
});

function ProfitLoss() {
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from).then(setBalances);
  }, [activeCompanyId, from, to]);

  const { incomes, expenses, totalInc, totalExp, profit } = useMemo(() => {
    const incomes = balances.filter((b) => PL_INCOME.has(b.type)).map((b) => ({ ...b, value: -b.closing_paise })); // income natural = Cr
    const expenses = balances.filter((b) => PL_EXPENSE.has(b.type)).map((b) => ({ ...b, value: b.closing_paise }));
    const totalInc = incomes.reduce((s, x) => s + x.value, 0);
    const totalExp = expenses.reduce((s, x) => s + x.value, 0);
    return { incomes, expenses, totalInc, totalExp, profit: totalInc - totalExp };
  }, [balances]);

  const onExport = () => {
    const data: (string | number)[][] = [
      [`Profit & Loss: ${from} to ${to}`, ""],
      ["EXPENSES", ""],
      ...expenses.filter((e) => e.value).map((e) => [e.name, (e.value / 100).toFixed(2)]),
      ["Total Expenses", (totalExp / 100).toFixed(2)],
      ["", ""],
      ["INCOMES", ""],
      ...incomes.filter((e) => e.value).map((e) => [e.name, (e.value / 100).toFixed(2)]),
      ["Total Income", (totalInc / 100).toFixed(2)],
      ["", ""],
      [profit >= 0 ? "Net Profit" : "Net Loss", (Math.abs(profit) / 100).toFixed(2)],
    ];
    downloadCsv(`profit-loss-${from}_to_${to}.csv`, data);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} onExport={onExport} onPrint={() => window.print()} />
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Expenses</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {expenses.filter((e) => e.value).map((e) => (
                  <TableRow key={e.id}><TableCell>{e.name}</TableCell><TableCell className="text-right font-mono">{formatINR(e.value)}</TableCell></TableRow>
                ))}
                {profit > 0 && (
                  <TableRow><TableCell className="font-semibold text-primary">Net Profit</TableCell><TableCell className="text-right font-mono font-semibold text-primary">{formatINR(profit)}</TableCell></TableRow>
                )}
                <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold">{formatINR(totalExp + Math.max(0, profit))}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Income</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {incomes.filter((e) => e.value).map((e) => (
                  <TableRow key={e.id}><TableCell>{e.name}</TableCell><TableCell className="text-right font-mono">{formatINR(e.value)}</TableCell></TableRow>
                ))}
                {profit < 0 && (
                  <TableRow><TableCell className="font-semibold text-destructive">Net Loss</TableCell><TableCell className="text-right font-mono font-semibold text-destructive">{formatINR(-profit)}</TableCell></TableRow>
                )}
                <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold">{formatINR(totalInc + Math.max(0, -profit))}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
