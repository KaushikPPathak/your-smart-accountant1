import { openVoucherDetail } from "@/lib/voucher-return";
import { sortVouchersAsc } from "@/lib/voucher-sort";
import { narrationOf } from "@/lib/voucher-text";
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
import { readLedgers, readVouchers, withCacheFallback } from "@/lib/offline/cache-read";
import { offlineDb } from "@/lib/offline/db";
import { normalizeVoucher } from "@/lib/offline/cache-normalizers";

async function readJournalVouchersByDate(
  companyId: string,
  from: string,
  to: string,
): Promise<any[]> {
  const rows = await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, from], [companyId, to], true, true)
    .toArray();
  const journals = (rows as any[]).filter((v) => v?.is_deleted !== true && v.voucher_type === "journal");
  const normalized = journals.map((v) => {
    try { return normalizeVoucher(v); } catch { return v; }
  });
  return normalized.sort((a: any, b: any) =>
    (a.voucher_date < b.voucher_date ? 1 : -1),
  );
}

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
    if (!activeCompanyId) return;
    let cancelled = false;
    setLoading(true);
    void withCacheFallback<Row[]>(
      async () => {
        const { data, error } = await supabase
          .from("vouchers")
          .select("id, voucher_date, voucher_number, voucher_type, total_paise, narration, reference_no, party_ledger_id, ledgers:party_ledger_id(name)")
          .eq("company_id", activeCompanyId)
          .eq("voucher_type", "journal")
          .gte("voucher_date", from)
          .lte("voucher_date", to)
          .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true });
        if (error) throw error;
        return (data || []) as unknown as Row[];
      },
      async () => {
        let vouchers: any[];
        try {
          vouchers = await readJournalVouchersByDate(activeCompanyId, from, to);
        } catch {
          vouchers = (await readVouchers(activeCompanyId, { from, to })).filter(v => v.voucher_type === 'journal');
        }
        const ledgers = await readLedgers(activeCompanyId);
        const ledgerNames = new Map((ledgers as any[]).map((l) => [String(l.id), String(l.name ?? "")]));
        return (vouchers as any[]).map((v) => ({
          id: String(v.id),
          voucher_date: String(v.voucher_date ?? ""),
          voucher_number: String(v.voucher_number ?? ""),
          voucher_type: String(v.voucher_type ?? ""),
          total_paise: Number(v.total_paise ?? 0),
          narration: v.narration ?? null,
          reference_no: v.reference_no ?? null,
          ledgers: v.party_ledger_id ? { name: ledgerNames.get(String(v.party_ledger_id)) ?? "" } : null,
        })) as Row[];
      },
    ).then((data) => {
      if (cancelled) return;
      setRows(sortVouchersAsc(data));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
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
              globalSearch={(r2) => `${r2.voucher_number} ${r2.ledgers?.name ?? ""} ${r2.reference_no ?? ""} ${narrationOf(null, r2)}`}
              onRowClick={(r2) => openVoucherDetail(navigate, r2.id)}
              height={560}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
