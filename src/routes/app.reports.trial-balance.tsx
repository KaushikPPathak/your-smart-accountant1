import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { amountHeader } from "@/lib/export-format";
import { openLedgerReport } from "@/lib/voucher-return";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { fmtIndianDate } from "@/lib/format-date";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { readLedgers, readVoucherEntriesWithVouchers, withCacheFallback } from "@/lib/offline/cache-read";

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
  const { view, setView } = useReportView("trial-balance");
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    void withCacheFallback<Ledger[]>(
      async () => {
        const { data, error } = await supabase
          .from("ledgers")
          .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
          .eq("company_id", activeCompanyId)
          .order("name");
        if (error) throw error;
        return (data || []) as Ledger[];
      },
      async () => (await readLedgers(activeCompanyId)).map((l: any) => ({
        id: String(l.id),
        name: String(l.name ?? ""),
        type: String(l.type ?? ""),
        opening_balance_paise: Number(l.opening_balance_paise ?? 0),
        opening_balance_is_debit: Boolean(l.opening_balance_is_debit),
      })),
    ).then((rows) => { if (!cancelled) setLedgers(rows); });
    return () => { cancelled = true; };
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    void withCacheFallback<Entry[]>(
      async () => {
        const { data, error } = await supabase
          .from("voucher_entries")
          .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
          .eq("vouchers.company_id", activeCompanyId)
          .lte("vouchers.voucher_date", to);
        if (error) throw error;
        return (data || []) as unknown as Entry[];
      },
      async () => (await readVoucherEntriesWithVouchers(activeCompanyId, { to })) as Entry[],
    ).then((rows) => { if (!cancelled) setEntries(rows); });
    return () => { cancelled = true; };
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
      ["Dr. Ledger", amountHeader(), "Cr. Ledger", amountHeader()],
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
      head: [["Dr. Ledger", amountHeader(), "Cr. Ledger", amountHeader()]],
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
            extra={<div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Closing balances as on <strong>{to}</strong>.
          </p>
        </CardContent>
      </Card>
      {view === "grid" ? (
        <Card><CardContent className="p-3">
          <DataGrid<typeof rows[number]>
            reportId="trial-balance"
            rows={rows}
            columns={[
              { id: "name", header: "Ledger", type: "text", width: 280, accessor: (x) => x.name, groupable: true },
              { id: "type", header: "Type", type: "enum", width: 160, accessor: (x) => x.type.replace(/_/g, " "), groupable: true },
              { id: "debit", header: "Debit", type: "number", width: 160, align: "right", accessor: (x) => x.debit / 100, cell: (x) => x.debit ? formatINR(x.debit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
              { id: "credit", header: "Credit", type: "number", width: 160, align: "right", accessor: (x) => x.credit / 100, cell: (x) => x.credit ? formatINR(x.credit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
            ] satisfies DGColumn<typeof rows[number]>[]}
            onRowClick={(x) => openLedgerReport(navigate, { ledgerId: x.id, from, to })}
            globalSearch={(x) => `${x.name} ${x.type}`}
            height={520}
          />
        </CardContent></Card>
      ) : (
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
      )}
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
