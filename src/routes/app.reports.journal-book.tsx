import { openVoucherDetail } from "@/lib/voucher-return";
import { narrationOf } from "@/lib/voucher-text";
import { toast } from "sonner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { fmtIndianDate } from "@/lib/format-date";
import { EmptyState } from "@/components/EmptyState";
import { BookOpen } from "lucide-react";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { QuickRangeChips } from "@/components/reports/QuickRangeChips";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { readLedgers, readVoucherEntriesWithVouchers, withCacheFallback } from "@/lib/offline/cache-read";
import { voucherTypeLabel } from "@/lib/voucher-type-label";

export const Route = createFileRoute("/app/reports/journal-book")({
  head: () => ({ meta: [{ title: "Journal Book — Reports" }] }),
  component: JournalBook,
});

/**
 * Journal Book row = ONE voucher entry (ledger posting), so the book shows
 * the classic Date / Vch No / Vch Type / Particulars / Narration / Dr / Cr
 * columns instead of a single net amount per voucher.
 */
interface Row {
  id: string;
  voucher_id: string;
  voucher_date: string;
  voucher_number: string;
  voucher_type: string;
  particulars: string;
  narration: string;
  reference_no: string;
  debit_paise: number;
  credit_paise: number;
}

/** Journal Book covers manual journals plus legacy/untyped vouchers. */
function isJournalType(t: string | null | undefined): boolean {
  return !t || t === "journal";
}

function JournalBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    setLoading(true);
    const loadData = async () => {
      try {
        const data = await withCacheFallback<Row[]>(
          async () => {
            const { data: res, error } = await supabase
              .from("voucher_entries")
              .select(
                "id, debit_paise, credit_paise, narration, ledgers:ledger_id(name), vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, reference_no, company_id)",
              )
              .eq("vouchers.company_id", activeCompanyId)
              .gte("vouchers.voucher_date", from)
              .lte("vouchers.voucher_date", to);
            if (error) throw error;
            return ((res || []) as any[])
              .filter((e) => isJournalType(e.vouchers?.voucher_type))
              .map((e) => toRow(e, String(e.ledgers?.name ?? "")));
          },
          async () => {
            const [entries, ledgers] = await Promise.all([
              readVoucherEntriesWithVouchers(activeCompanyId, { from, to }),
              readLedgers(activeCompanyId),
            ]);
            const names = new Map(
              (ledgers as any[]).map((l) => [String(l.id), String(l.name ?? "")]),
            );
            return (entries as any[])
              .filter((e) => isJournalType(e.vouchers?.voucher_type))
              .map((e) => toRow(e, names.get(String(e.ledger_id)) ?? ""));
          },
        );
        if (!cancelled) setRows(sortRows(data));
      } catch (err) {
        console.error("Journal Book failure:", err);
        if (!cancelled) toast.error("Failed to load Journal Book. Check console for details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, from, to]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          debit: acc.debit + row.debit_paise,
          credit: acc.credit + row.credit_paise,
        }),
        { debit: 0, credit: 0 },
      ),
    [rows],
  );

  const HEAD = ["Date", "Vch No", "Vch Type", "Particulars", "Narration", "Debit", "Credit"];

  const bodyRows = (): (string | number)[][] =>
    rows.map((row) => [
      fmtIndianDate(row.voucher_date),
      row.voucher_number,
      voucherTypeLabel(row.voucher_type || "journal", "en"),
      row.particulars,
      row.narration,
      (row.debit_paise / 100).toFixed(2),
      (row.credit_paise / 100).toFixed(2),
    ]);

  const csvRows = (): (string | number)[][] => [
    HEAD,
    ...bodyRows(),
    ["", "", "", "", "Total", (totals.debit / 100).toFixed(2), (totals.credit / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`journal-book-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`journal-book-${from}_to_${to}.xlsx`, [{ name: "Journal Book", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Journal Book",
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      head: [HEAD],
      body: bodyRows(),
      foot: [["", "", "", "", "Total", r(totals.debit).toFixed(2), r(totals.credit).toFixed(2)]],
      fileName: `journal-book-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [5, 6],
    });

  const money = (id: string, header: string, pick: (row: Row) => number): DGColumn<Row> => ({
    id,
    header,
    type: "number",
    width: 130,
    align: "right",
    accessor: (row) => pick(row) / 100,
    cell: (row) => (pick(row) === 0 ? "" : formatINR(pick(row))),
    aggregator: "sum",
    formatAggregate: (v) => formatINR(Math.round(v * 100)),
    formatGroupValue: (v) => formatINR(Math.round(v * 100)),
  });

  const gridColumns: DGColumn<Row>[] = useMemo(
    () => [
      { id: "date", header: "Date", type: "date", width: 105, accessor: (row) => row.voucher_date, cell: (row) => fmtIndianDate(row.voucher_date) },
      { id: "number", header: "Vch No", type: "text", width: 110, accessor: (row) => row.voucher_number, groupable: true },
      { id: "vtype", header: "Vch Type", type: "enum", width: 110, accessor: (row) => voucherTypeLabel(row.voucher_type || "journal", "en"), groupable: true },
      { id: "party", header: "Particulars", type: "text", width: 240, accessor: (row) => row.particulars, groupable: true, cell: (row) => row.particulars || "—" },
      { id: "narration", header: "Narration", type: "text", width: 240, accessor: (row) => row.narration },
      { id: "ref", header: "Ref", type: "text", width: 100, accessor: (row) => row.reference_no },
      money("debit", "Debit (₹)", (row) => row.debit_paise),
      money("credit", "Credit (₹)", (row) => row.credit_paise),
    ],
    [],
  );

  return (
    <ReportViewer
      title="Journal Book"
      fromDate={from}
      toDate={to}
      orientation="landscape"
      onExportPdf={onExportPdf}
    >
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
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <QuickRangeChips from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          </div>
        </CardContent>
      </Card>
      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-6"><EmptyState icon={BookOpen} title="No journals in range" description="Adjust the date filter or post some journal vouchers." /></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId="journal-book"
              rows={rows}
              columns={gridColumns}
              footerLabel="Total"
              globalSearch={(row) =>
                `${row.voucher_date} ${row.voucher_number} ${row.particulars} ${row.reference_no} ${row.narration}`
              }
              onRowClick={(row) => openVoucherDetail(navigate, row.voucher_id)}
              height={560}
            />
          </CardContent>
        </Card>
      )}
    </ReportViewer>
  );
}

function toRow(entry: any, ledgerName: string): Row {
  const v = entry.vouchers ?? {};
  return {
    id: String(entry.id),
    voucher_id: String(v.id ?? entry.voucher_id ?? ""),
    voucher_date: String(v.voucher_date ?? ""),
    voucher_number: String(v.voucher_number ?? ""),
    voucher_type: String(v.voucher_type ?? ""),
    particulars: ledgerName,
    narration: narrationOf(entry, v) ?? "",
    reference_no: String(v.reference_no ?? ""),
    debit_paise: Number(entry.debit_paise ?? 0),
    credit_paise: Number(entry.credit_paise ?? 0),
  };
}

/** Date, then voucher number, then debits before credits (book convention). */
function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? -1 : 1;
    if (a.voucher_number !== b.voucher_number)
      return a.voucher_number.localeCompare(b.voucher_number, undefined, { numeric: true });
    return b.debit_paise - a.debit_paise;
  });
}
