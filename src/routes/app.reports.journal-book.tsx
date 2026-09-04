import { openVoucherDetail } from "@/lib/voucher-return";
import { sortVouchersAsc } from "@/lib/voucher-sort";
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
import { readLedgers, readVouchers } from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/reports/journal-book")({
  head: () => ({ meta: [{ title: "Journal Book — Reports" }] }),
  component: JournalBook,
});

interface Row {
  id: string;
  voucher_date: string;
  voucher_number: string;
  voucher_type: string;
  total_paise: number;
  narration: string | null;
  reference_no: string | null;
  ledgers: { name: string } | null;
}

function JournalBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const loadData = async () => {
      // Journal Book must never remain stuck behind a network request.
      // Read the local accounting cache first, then refresh from Supabase
      // when available. This also makes the report work reliably in the
      // desktop/offline build.
      try {
        let cacheRows: Row[] = [];
        try {
          const [vouchers, ledgers] = await Promise.all([
            readVouchers(activeCompanyId, { from, to }),
            readLedgers(activeCompanyId),
          ]);
          const ledgerNames = new Map(
            (ledgers as any[]).map((l) => [String(l.id), String(l.name ?? "")]),
          );
          const journalVouchers = (vouchers as any[]).filter((v) => {
            const type = String(v?.voucher_type ?? "").trim().toLowerCase();
            // Legacy restored backups can contain Journal vouchers with a
            // missing/null voucher_type. Existing reports historically treat
            // those untyped entry vouchers as Journal, so preserve that
            // compatibility instead of silently hiding them.
            return type === "journal" || type === "";
          });
          cacheRows = journalVouchers.map((v) => ({
            id: String(v.id),
            voucher_date: String(v.voucher_date ?? ""),
            voucher_number: String(v.voucher_number ?? ""),
            voucher_type: String(v.voucher_type ?? "journal"),
            total_paise: Number(v.total_paise ?? 0),
            narration: v.narration ?? null,
            reference_no: v.reference_no ?? null,
            ledgers: v.party_ledger_id
              ? { name: ledgerNames.get(String(v.party_ledger_id)) ?? "" }
              : null,
          })) as Row[];
        } catch (cacheErr) {
          console.warn("Journal book cache read error:", cacheErr);
        }

        // Render cached data immediately if we have it; do not make the UI
        // wait for Supabase. The cloud refresh is bounded so a dead/hanging
        // network cannot leave the report showing Loading forever.
        if (!cancelled && cacheRows.length > 0) {
          setRows(sortVouchersAsc(cacheRows));
          setLoading(false);
        }

        let cloudRows: Row[] | null = null;
        try {
          const cloudPromise = supabase
            .from("vouchers")
            .select(
              "id, voucher_date, voucher_number, voucher_type, total_paise, narration, reference_no, party_ledger_id, ledgers:party_ledger_id(name)",
            )
            .eq("company_id", activeCompanyId)
            .gte("voucher_date", from)
            .lte("voucher_date", to)
            .order("voucher_date", { ascending: true })
            .order("voucher_number", { ascending: true });

          const timeout = new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("Journal Book cloud query timed out")), 8000),
          );
          const { data: res, error } = await Promise.race([cloudPromise, timeout]);
          if (error) throw error;
          cloudRows = ((res || []) as unknown as Row[]).filter((r) => {
            const type = String(r?.voucher_type ?? "").trim().toLowerCase();
            return type === "journal" || type === "";
          });
        } catch (cloudErr) {
          console.warn("Journal book cloud refresh unavailable; using cache:", cloudErr);
        }

        if (!cancelled) {
          if (cloudRows && cloudRows.length > 0) {
            setRows(sortVouchersAsc(cloudRows));
          } else if (cacheRows.length === 0) {
            setRows([]);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error("Journal Book failure:", err);
        if (!cancelled) {
          setRows([]);
          setLoading(false);
          toast.error("Failed to load Journal Book. Check console for details.");
        }
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [activeCompanyId, from, to]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);

  const csvRows = (): (string | number)[][] => [
    ["Date", "Number", "Particulars", "Narration", "Amount"],
    ...rows.map((r2) => [
      fmtIndianDate(r2.voucher_date),
      r2.voucher_number,
      r2.ledgers?.name ?? "",
      narrationOf(null, r2),
      (r2.total_paise / 100).toFixed(2),
    ]),
    ["", "", "", "Total", (total / 100).toFixed(2)],
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
      head: [["Date", "Number", "Particulars", "Narration", "Amount"]],
      body: rows.map((r2) => [
        fmtIndianDate(r2.voucher_date),
        r2.voucher_number,
        r2.ledgers?.name ?? "",
        narrationOf(null, r2),
        r(r2.total_paise).toFixed(2),
      ]),
      foot: [["", "", "", "Total", r(total).toFixed(2)]],
      fileName: `journal-book-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [4],
    });

  const gridColumns: DGColumn<Row>[] = useMemo(() => [
    { id: "date", header: "Date", type: "date", width: 110, accessor: (r2) => r2.voucher_date, cell: (r2) => fmtIndianDate(r2.voucher_date) },
    { id: "number", header: "No.", type: "text", width: 110, accessor: (r2) => r2.voucher_number },
    { id: "party", header: "Particulars", type: "text", width: 220, accessor: (r2) => r2.ledgers?.name ?? "", groupable: true, cell: (r2) => r2.ledgers?.name ?? "—" },
    { id: "narration", header: "Narration", type: "text", width: 260, accessor: (r2) => narrationOf(null, r2) },
    { id: "ref", header: "Ref", type: "text", width: 110, accessor: (r2) => r2.reference_no ?? "" },
    {
      id: "amount", header: "Amount", type: "number", width: 140, align: "right",
      accessor: (r2) => r2.total_paise / 100,
      cell: (r2) => formatINR(r2.total_paise),
      aggregator: "sum",
      formatAggregate: (v) => formatINR(Math.round(v * 100)),
      formatGroupValue: (v) => formatINR(Math.round(v * 100)),
    },
  ], []);

  return (
    <ReportViewer
      title="Journal Book"
      fromDate={from}
      toDate={to}
      onExportPdf={onExportPdf}
      orientation="landscape"
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
        <>
          {/* Interactive grid is screen-only. DataGrid virtualization can keep
              rows outside the DOM, so it must never be the print source. */}
          <Card className="print:hidden">
            <CardContent className="p-3">
              <DataGrid
                reportId="journal-book"
                rows={rows}
                columns={gridColumns}
                globalSearch={(r2) => `${r2.voucher_date} ${r2.voucher_number} ${r2.ledgers?.name ?? ""} ${r2.reference_no ?? ""} ${narrationOf(null, r2)}`}
                onRowClick={(r2) => openVoucherDetail(navigate, r2.id)}
                height={560}
              />
            </CardContent>
          </Card>

          {/* Dedicated static print representation: all rows are present in the
              DOM and the accounting report is independent of DataGrid sizing,
              virtualization, scrolling, or screen auto-fit. */}
          <div className="hidden print:block journal-book-print-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>No.</th>
                  <th>Particulars</th>
                  <th>Narration</th>
                  <th>Ref</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r2) => (
                  <tr key={r2.id}>
                    <td>{fmtIndianDate(r2.voucher_date)}</td>
                    <td>{r2.voucher_number}</td>
                    <td>{r2.ledgers?.name ?? ""}</td>
                    <td className="narration-cell">{narrationOf(null, r2)}</td>
                    <td>{r2.reference_no ?? ""}</td>
                    <td className="num">{formatINR(r2.total_paise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="row-bold">
                  <td colSpan={5}>Total</td>
                  <td className="num">{formatINR(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </ReportViewer>
  );
}
