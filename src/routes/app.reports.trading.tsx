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
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/reports/trading")({
  head: () => ({ meta: [{ title: "Trading Account — Reports" }] }),
  component: TradingAccount,
});

function TradingAccount() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);
  const [openingStock, setOpeningStock] = useState(0);
  const [closingStock, setClosingStock] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, to, from).then(setBalances);
  }, [activeCompanyId, from, to]);

  // Opening stock: opening balances of stock_in_hand ledgers (or items opening * rate)
  // Closing stock: items qty * rate (best estimate without inventory valuation engine)
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
      // Closing stock — without movement engine, treat as same as opening (manual value).
      setClosingStock(ledOp || itemOp);
    });
  }, [activeCompanyId]);

  const { directIncome, directExp, totalSales, totalDirect, gp } = useMemo(() => {
    // Direct income = Sales-like; direct expense = Purchase / Direct Exp.
    const directIncome = balances.filter((b) => b.type === "income_direct").map((b) => ({ ...b, value: -b.closing_paise }));
    const directExp = balances.filter((b) => b.type === "expense_direct").map((b) => ({ ...b, value: b.closing_paise }));
    const totalSales = directIncome.reduce((s, x) => s + x.value, 0);
    const totalDirect = directExp.reduce((s, x) => s + x.value, 0);
    // Gross Profit = (Sales + Closing Stock) - (Opening Stock + Direct Exp)
    const gp = (totalSales + closingStock) - (totalDirect + openingStock);
    return { directIncome, directExp, totalSales, totalDirect, gp };
  }, [balances, openingStock, closingStock]);

  // Dr (left) — Opening stock, Purchases & direct exp, Gross Profit c/d (if positive)
  const drRows: TRow[] = [];
  if (openingStock) drRows.push({ label: "To Opening Stock", amount: formatINR(openingStock), emphasis: "bold" });
  for (const e of directExp.filter((x) => x.value)) {
    drRows.push({
      label: <>To {e.name}</>,
      amount: formatINR(e.value),
      onClick: () => navigate({ to: "/app/reports/ledger", search: { ledgerId: e.id, from, to } }),
    });
  }
  if (gp > 0) drRows.push({ label: "To Gross Profit c/d", amount: formatINR(gp), emphasis: "total" });

  // Cr (right) — Sales, Closing Stock, Gross Loss c/d (if negative)
  const crRows: TRow[] = [];
  for (const e of directIncome.filter((x) => x.value)) {
    crRows.push({
      label: <>By {e.name}</>,
      amount: formatINR(e.value),
      onClick: () => navigate({ to: "/app/reports/ledger", search: { ledgerId: e.id, from, to } }),
    });
  }
  if (closingStock) crRows.push({ label: "By Closing Stock", amount: formatINR(closingStock), emphasis: "bold" });
  if (gp < 0) crRows.push({ label: "By Gross Loss c/d", amount: formatINR(-gp), emphasis: "total" });

  const grandLeft = openingStock + totalDirect + Math.max(0, gp);
  const grandRight = totalSales + closingStock + Math.max(0, -gp);

  // Plain (string-only) export rows derived from source data,
  // independent of the JSX TRow rendering used on screen.
  type ExportRow = { label: string; paise: number };
  const drExport: ExportRow[] = [];
  if (openingStock) drExport.push({ label: "To Opening Stock", paise: openingStock });
  for (const e of directExp.filter((x) => x.value)) drExport.push({ label: `To ${e.name}`, paise: e.value });
  if (gp > 0) drExport.push({ label: "To Gross Profit c/d", paise: gp });

  const crExport: ExportRow[] = [];
  for (const e of directIncome.filter((x) => x.value)) crExport.push({ label: `By ${e.name}`, paise: e.value });
  if (closingStock) crExport.push({ label: "By Closing Stock", paise: closingStock });
  if (gp < 0) crExport.push({ label: "By Gross Loss c/d", paise: -gp });

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
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Direct Income (Sales) and Direct Expenses (Purchase / Direct Exp) only. Gross Profit / Loss flows to the P&L account.
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
