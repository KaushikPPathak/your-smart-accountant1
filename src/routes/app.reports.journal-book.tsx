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
import { QuickRangeChips } from "@/components/reports/QuickRangeChips";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { readLedgers, readVoucherEntriesForCompany, readVouchers } from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/reports/journal-book")({
  head: () => ({ meta: [{ title: "Journal Book — Reports" }] }),
  component: JournalBook,
});

interface JournalRow {
  id: string;
  voucherId: string;
  voucher_date: string;
  voucher_number: string;
  ledger_name: string;
  narration: string;
  reference_no: string;
  debit_paise: number;
  credit_paise: number;
}

function journalRowsFromLocal(
  vouchers: any[],
  entries: any[],
  ledgers: any[],
): JournalRow[] {
  const voucherMap = new Map(vouchers.map((v) => [String(v.id), v]));
  const ledgerMap = new Map(ledgers.map((l) => [String(l.id), String(l.name ?? "")]));

  const out: JournalRow[] = [];
  for (const e of entries) {
    const v = voucherMap.get(String(e.voucher_id));
    if (!v || v.is_deleted === true) continue;
    const type = String(v.voucher_type ?? "").trim().toLowerCase();
    // Restored/legacy backups can contain old Journal vouchers with a blank
    // voucher_type. Keep them visible in Journal Book for compatibility.
    if (type !== "journal" && type !== "") continue;

    const debit = Number(e.debit_paise ?? 0);
    const credit = Number(e.credit_paise ?? 0);
    if (debit === 0 && credit === 0) continue;

    out.push({
      id: String(e.id ?? `${v.id}:${e.ledger_id}`),
      voucherId: String(v.id),
      voucher_date: String(v.voucher_date ?? ""),
      voucher_number: String(v.voucher_number ?? ""),
      ledger_name: ledgerMap.get(String(e.ledger_id)) ?? "",
      narration: String(e.narration ?? v.narration ?? ""),
      reference_no: String(v.reference_no ?? ""),
      debit_paise: debit,
      credit_paise: credit,
    });
  }

  return out.sort((a, b) => {
    if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? -1 : 1;
    const an = Number(a.voucher_number);
    const bn = Number(b.voucher_number);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    if (a.voucher_number !== b.voucher_number) return a.voucher_number.localeCompare(b.voucher_number);
    return a.id.localeCompare(b.id);
  });
}

function JournalBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<JournalRow[]>([]);
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
      try {
        // LOCAL FIRST: this is the authoritative source for restored/offline
        // data. The screen is released as soon as this read finishes.
        let localRows: JournalRow[] = [];
        try {
          const vouchersPromise = readVouchers(activeCompanyId, { from, to });
          const [vouchers, entries, ledgers] = await Promise.all([
            vouchersPromise,
            readVoucherEntriesForCompany(activeCompanyId, vouchersPromise),
            readLedgers(activeCompanyId),
          ]);
          localRows = journalRowsFromLocal(vouchers as any[], entries as any[], ledgers as any[]);
        } catch (err) {
          console.warn("Journal Book local read error:", err);
        }

        if (!cancelled) {
          setRows(localRows);
          setLoading(false);
        }

        // CLOUD REFRESH: completely independent from the loading state. It can
        // update the view later but can never leave the report stuck on Loading.
        try {
          const cloudPromise = supabase
            .from("voucher_entries")
            .select(
              "id, voucher_id, ledger_id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, reference_no, company_id)",
            )
            .eq("vouchers.company_id", activeCompanyId)
            .gte("vouchers.voucher_date", from)
            .lte("vouchers.voucher_date", to);

          const timeout = new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("Journal Book cloud query timed out")), 8000),
          );
          const result = await Promise.race([cloudPromise, timeout]);
          if (result.error) throw result.error;

          const cloudRows: JournalRow[] = [];
          const cloudRawRows = (result.data ?? []) as any[];
          const ledgerIds = [...new Set(
            cloudRawRows.map((x) => String(x.ledger_id ?? "")).filter(Boolean),
          )];
          const ledgerNames = new Map<string, string>();
          if (ledgerIds.length > 0) {
            const { data: ledgers, error: ledgerError } = await supabase
              .from("ledgers")
              .select("id, name")
              .in("id", ledgerIds);
            if (!ledgerError) {
              for (const l of (ledgers ?? []) as any[]) {
                ledgerNames.set(String(l.id), String(l.name ?? ""));
              }
            }
          }
          for (const raw of cloudRawRows) {
            const v = raw.vouchers;
            if (!v) continue;
            const type = String(v.voucher_type ?? "").trim().toLowerCase();
            if (type !== "journal" && type !== "") continue;
            const debit = Number(raw.debit_paise ?? 0);
            const credit = Number(raw.credit_paise ?? 0);
            if (debit === 0 && credit === 0) continue;
            cloudRows.push({
              id: String(raw.id),
              voucherId: String(raw.voucher_id),
              voucher_date: String(v.voucher_date ?? ""),
              voucher_number: String(v.voucher_number ?? ""),
              ledger_name: ledgerNames.get(String(raw.ledger_id ?? "")) ?? "",
              narration: String(raw.narration ?? v.narration ?? ""),
              reference_no: String(v.reference_no ?? ""),
              debit_paise: debit,
              credit_paise: credit,
            });
          }
          cloudRows.sort((a, b) => {
            if (a.voucher_date !== b.voucher_date) return a.voucher_date < b.voucher_date ? -1 : 1;
            if (a.voucher_number !== b.voucher_number) return a.voucher_number.localeCompare(b.voucher_number);
            return a.id.localeCompare(b.id);
          });

          if (!cancelled && cloudRows.length > 0) {
            setRows(cloudRows);
          }
        } catch (err) {
          console.warn("Journal Book cloud refresh unavailable; keeping local data:", err);
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

  const totals = useMemo(() => rows.reduce(
    (s, row) => ({ debit: s.debit + row.debit_paise, credit: s.credit + row.credit_paise }),
    { debit: 0, credit: 0 },
  ), [rows]);

  const csvRows = (): (string | number)[][] => [
    ["Date", "Number", "Particulars", "Narration", "Ref", "Debit", "Credit"],
    ...rows.map((row) => [
      fmtIndianDate(row.voucher_date),
      row.voucher_number,
      row.ledger_name,
      row.narration,
      row.reference_no,
      (row.debit_paise / 100).toFixed(2),
      (row.credit_paise / 100).toFixed(2),
    ]),
    ["", "", "", "Total", "", (totals.debit / 100).toFixed(2), (totals.credit / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`journal-book-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`journal-book-${from}_to_${to}.xlsx`, [{ name: "Journal Book", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Journal Book",
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      // Use the selected report period for this report's FY line. This avoids
      // printing FY 2026-27 when the user is viewing the restored FY 2025-26.
      companySubLine: journalFyLabel(from, to),
      head: [["Date", "Number", "Particulars", "Narration", "Ref", "Debit", "Credit"]],
      body: rows.map((row) => [
        fmtIndianDate(row.voucher_date),
        row.voucher_number,
        row.ledger_name,
        row.narration,
        row.reference_no,
        row.debit_paise ? r(row.debit_paise).toFixed(2) : "",
        row.credit_paise ? r(row.credit_paise).toFixed(2) : "",
      ]),
      foot: [["", "", "", "Total", "", r(totals.debit).toFixed(2), r(totals.credit).toFixed(2)]],
      fileName: `journal-book-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [5, 6],
    });

  return (
    <ReportViewer
      title="Journal Book"
      fromDate={from}
      toDate={to}
      onExportPdf={onExportPdf}
      orientation="landscape"
      // Journal Book may be viewed for an older FY than the company's current
      // FY, especially after restoring a legacy backup.
      financialYearStartOverride={journalFyStart(from, to)}
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
          {/* Static HTML is used for both screen and print. It guarantees that
              every voucher-entry row is visible and avoids DataGrid virtualization
              hiding rows from the report/print pipeline. */}
          <Card className="print:hidden">
            <CardContent className="p-3 overflow-x-auto">
              <JournalTable rows={rows} onRowClick={(row) => openVoucherDetail(navigate, row.voucherId)} totals={totals} />
            </CardContent>
          </Card>

          <div className="hidden print:block journal-book-print-table">
            <JournalTable rows={rows} totals={totals} />
          </div>
        </>
      )}
    </ReportViewer>
  );
}

function JournalTable({
  rows,
  totals,
  onRowClick,
}: {
  rows: JournalRow[];
  totals: { debit: number; credit: number };
  onRowClick?: (row: JournalRow) => void;
}) {
  return (
    <table className="w-full min-w-[980px] border-collapse text-[12px]">
      <thead>
        <tr>
          {['Date', 'No.', 'Particulars', 'Narration', 'Ref', 'Debit', 'Credit'].map((h) => (
            <th key={h} className="border border-border bg-muted/40 px-2 py-1.5 text-left font-semibold last:text-right">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={onRowClick ? "cursor-pointer hover:bg-muted/30" : undefined}
            onClick={() => onRowClick?.(row)}
          >
            <td className="border border-border px-2 py-1 whitespace-nowrap">{fmtIndianDate(row.voucher_date)}</td>
            <td className="border border-border px-2 py-1 whitespace-nowrap">{row.voucher_number}</td>
            <td className="border border-border px-2 py-1">{row.ledger_name || "—"}</td>
            <td className="border border-border px-2 py-1">{row.narration}</td>
            <td className="border border-border px-2 py-1">{row.reference_no}</td>
            <td className="border border-border px-2 py-1 text-right font-mono whitespace-nowrap">{row.debit_paise ? formatINR(row.debit_paise, { symbol: false }) : ""}</td>
            <td className="border border-border px-2 py-1 text-right font-mono whitespace-nowrap">{row.credit_paise ? formatINR(row.credit_paise, { symbol: false }) : ""}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-bold">
          <td className="border border-border px-2 py-1" colSpan={5}>Total</td>
          <td className="border border-border px-2 py-1 text-right font-mono">{formatINR(totals.debit, { symbol: false })}</td>
          <td className="border border-border px-2 py-1 text-right font-mono">{formatINR(totals.credit, { symbol: false })}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function journalFyStart(from: string, to: string): string | undefined {
  const m = /^(\d{4})-04-01$/.exec(from);
  const end = /^(\d{4})-03-31$/.exec(to);
  if (!m || !end || Number(end[1]) !== Number(m[1]) + 1) return undefined;
  return from;
}

function journalFyLabel(from: string, to: string): string {
  const start = journalFyStart(from, to);
  if (!start) return "";
  const y = Number(start.slice(0, 4));
  return `Financial Year ${y}-${String(y + 1).slice(-2)}`;
}
