import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { openLedgerReport } from "@/lib/voucher-return";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { fmtIndianDate } from "@/lib/format-date";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/trial-balance")({
  head: () => ({ meta: [{ title: "Trial Balance — Reports" }] }),
  component: TrialBalance,
});

interface Ledger {
  id: string;
  name: string;
  type: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

interface Entry {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string } | null;
}

function TrialBalance() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("ledgers")
      .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
      .eq("company_id", activeCompanyId)
      .order("name")
      .then(({ data }) => setLedgers((data || []) as Ledger[]));
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("voucher_entries")
      .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
      .eq("vouchers.company_id", activeCompanyId)
      .lte("vouchers.voucher_date", to)
      .then(({ data }) => setEntries((data || []) as unknown as Entry[]));
  }, [activeCompanyId, to]);

  const rows = useMemo(() => {
    return ledgers.map((l) => {
      const obSigned = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
      const movement = entries
        .filter((e) => e.ledger_id === l.id && e.vouchers && e.vouchers.voucher_date <= to)
        .reduce((s, e) => s + e.debit_paise - e.credit_paise, 0);
      const closing = obSigned + movement;
      return { ...l, debit: closing > 0 ? closing : 0, credit: closing < 0 ? -closing : 0 };
    });
  }, [ledgers, entries, to]);

  const drRows: TRow[] = rows
    .filter((r2) => r2.debit)
    .map((r2) => ({
      label: r2.name,
      amount: formatINR(r2.debit),
      onClick: () => openLedgerReport(navigate, { ledgerId: r2.id, from, to }),
    }));
  const crRows: TRow[] = rows
    .filter((r2) => r2.credit)
    .map((r2) => ({
      label: r2.name,
      amount: formatINR(r2.credit),
      onClick: () => openLedgerReport(navigate, { ledgerId: r2.id, from, to }),
    }));

  const totals = rows.reduce(
    (acc, r2) => ({ dr: acc.dr + r2.debit, cr: acc.cr + r2.credit }),
    { dr: 0, cr: 0 },
  );

  const csvRows = (): (string | number)[][] => {
    const max = Math.max(drRows.length, crRows.length);
    const drList = rows.filter((r2) => r2.debit);
    const crList = rows.filter((r2) => r2.credit);
    return [
      [`Trial Balance as on ${to}`, "", "", ""],
      ["Dr. Ledger", "Amount (₹)", "Cr. Ledger", "Amount (₹)"],
      ...Array.from({ length: max }).map((_, i) => [
        drList[i]?.name ?? "",
        drList[i] ? (drList[i].debit / 100).toFixed(2) : "",
        crList[i]?.name ?? "",
        crList[i] ? (crList[i].credit / 100).toFixed(2) : "",
      ]),
      ["Total", (totals.dr / 100).toFixed(2), "Total", (totals.cr / 100).toFixed(2)],
    ];
  };

  const onExportCsv = () => downloadCsv(`trial-balance-${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`trial-balance-${to}.xlsx`, [{ name: "Trial Balance", rows: csvRows() }]);
  const onExportPdf = () => {
    const drList = rows.filter((r2) => r2.debit);
    const crList = rows.filter((r2) => r2.credit);
    const max = Math.max(drList.length, crList.length);
    downloadPdfTable({
      title: "Trial Balance",
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `As on ${fmtIndianDate(to)}`,
      head: [["Dr. Ledger", "Amount (₹)", "Cr. Ledger", "Amount (₹)"]],
      body: Array.from({ length: max }).map((_, i) => [
        drList[i]?.name ?? "",
        drList[i] ? r(drList[i].debit).toFixed(2) : "",
        crList[i]?.name ?? "",
        crList[i] ? r(crList[i].credit).toFixed(2) : "",
      ]),
      foot: [["Total", r(totals.dr).toFixed(2), "Total", r(totals.cr).toFixed(2)]],
      fileName: `trial-balance-${to}.pdf`,
      orientation: "l",
      rightAlignCols: [1, 3],
    });
  };

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
            Closing balances as on <strong>{to}</strong>.
          </p>
        </CardContent>
      </Card>
      <TAccount
        title="Trial Balance"
        subtitle={`as on ${to}`}
        leftHeader="Dr. Ledger"
        rightHeader="Cr. Ledger"
        leftRows={drRows}
        rightRows={crRows}
        leftTotal={formatINR(totals.dr)}
        rightTotal={formatINR(totals.cr)}
      />
      {totals.dr !== totals.cr && (
        <Card>
          <CardContent className="p-3 text-center text-sm text-destructive">
            ⚠ Difference: {formatINR(Math.abs(totals.dr - totals.cr))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
