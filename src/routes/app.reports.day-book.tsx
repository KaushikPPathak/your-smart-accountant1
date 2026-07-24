import { openVoucherDetail } from "@/lib/voucher-return";
import { sortVouchersAsc } from "@/lib/voucher-sort";
import { narrationOf } from "@/lib/voucher-text";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { fmtIndianDate } from "@/lib/format-date";
import { EmptyState } from "@/components/EmptyState";
import { BookOpen, LayoutGrid, Columns2 } from "lucide-react";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { QuickRangeChips } from "@/components/reports/QuickRangeChips";
import { Button } from "@/components/ui/button";
import { readLedgers, readVouchers, withCacheFallback } from "@/lib/offline/cache-read";
import { offlineDb } from "@/lib/offline/db";
import { normalizeVoucher } from "@/lib/offline/cache-normalizers";

/**
 * Step 2a — zero-risk fast path for Day Book.
 *
 * Uses the v8 compound index [company_id+voucher_date] to range-scan
 * vouchers directly instead of loading every voucher for the company
 * and filtering in JS. If the index is unavailable for any reason
 * (browser mid-upgrade, older cache, unexpected error) we silently
 * throw and the caller falls back to the original readVouchers path.
 * Correctness is unchanged either way — only speed differs.
 */
async function readVouchersByDateFast(
  companyId: string,
  from: string,
  to: string,
): Promise<any[]> {
  const rows = await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, from], [companyId, to], true, true)
    .toArray();
  const live = (rows as any[]).filter((v) => v?.is_deleted !== true);
  const normalized = live.map((v) => {
    try { return normalizeVoucher(v); } catch { return v; }
  });
  return normalized.sort((a: any, b: any) =>
    (a.voucher_date < b.voucher_date ? 1 : -1),
  );
}

export const Route = createFileRoute("/app/reports/day-book")({
  head: () => ({ meta: [{ title: "Day Book — Reports" }] }),
  component: DayBook,
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

const TYPE_LABEL: Record<string, string> = {
  sales: "Sales",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  journal: "Journal",
  contra: "Contra",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

// Voucher types whose net effect is a debit movement on the day-book "money out / asset / expense" side
const DR_TYPES = new Set(["purchase", "payment", "debit_note"]);
// Voucher types whose net effect is a credit movement on the "money in / income / liability" side
const CR_TYPES = new Set(["sales", "receipt", "credit_note"]);

function DayBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"t" | "grid">(() => {
    if (typeof window === "undefined") return "t";
    return (localStorage.getItem("daybook:view") as "t" | "grid") ?? "t";
  });
  useEffect(() => { try { localStorage.setItem("daybook:view", view); } catch { /* ignore */ } }, [view]);

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
          .gte("voucher_date", from)
          .lte("voucher_date", to)
          .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true });
        if (error) throw error;
        return (data || []) as unknown as Row[];
      },
      async () => {
        // Fast path: compound-index range scan (v8). Falls through to
        // the original readVouchers() on ANY failure, so results are
        // always correct.
        let vouchers: any[];
        try {
          vouchers = await readVouchersByDateFast(activeCompanyId, from, to);
        } catch {
          vouchers = await readVouchers(activeCompanyId, { from, to });
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

  const { drRows, crRows, drTotal, crTotal } = useMemo(() => {
    const drRows: TRow[] = [];
    const crRows: TRow[] = [];
    let drTotal = 0;
    let crTotal = 0;
    for (const r2 of rows) {
      const label = `${TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type} — ${r2.ledgers?.name ?? "—"}`;
      const narr = narrationOf(null, r2);
      const hint = `${fmtIndianDate(r2.voucher_date)} · ${r2.voucher_number}${narr ? ` · ${narr}` : ""}`;
      const onClick = () => openVoucherDetail(navigate, r2.id);
      const tRow: TRow = { label, hint, amount: formatINR(r2.total_paise), onClick };
      if (DR_TYPES.has(r2.voucher_type)) {
        drRows.push(tRow);
        drTotal += r2.total_paise;
      } else if (CR_TYPES.has(r2.voucher_type)) {
        crRows.push(tRow);
        crTotal += r2.total_paise;
      } else {
        // journal/contra — show on Dr side
        drRows.push(tRow);
        drTotal += r2.total_paise;
      }
    }
    return { drRows, crRows, drTotal, crTotal };
  }, [rows, navigate]);

  const total = drTotal + crTotal;

  const csvRows = (): (string | number)[][] => [
    ["Date", "Type", "Number", "Party", "Narration", "Side", "Amount"],
    ...rows.map((r2) => [
      fmtIndianDate(r2.voucher_date),
      TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type,
      r2.voucher_number,
      r2.ledgers?.name ?? "",
      narrationOf(null, r2),
      DR_TYPES.has(r2.voucher_type) ? "Dr" : CR_TYPES.has(r2.voucher_type) ? "Cr" : "Dr",
      (r2.total_paise / 100).toFixed(2),
    ]),
    ["", "", "", "", "", "Total", (total / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`day-book-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`day-book-${from}_to_${to}.xlsx`, [{ name: "Day Book", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Day Book",
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      head: [["Date", "Type", "Number", "Party", "Narration", "Side", "Amount"]],
      body: rows.map((r2) => [
        fmtIndianDate(r2.voucher_date),
        TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type,
        r2.voucher_number,
        r2.ledgers?.name ?? "",
        narrationOf(null, r2),
        DR_TYPES.has(r2.voucher_type) ? "Dr" : CR_TYPES.has(r2.voucher_type) ? "Cr" : "Dr",
        r(r2.total_paise).toFixed(2),
      ]),
      foot: [["", "", "", "", "", "Total", r(total).toFixed(2)]],
      fileName: `day-book-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [6],
    });

  const gridColumns: DGColumn<Row>[] = useMemo(() => [
    { id: "date", header: "Date", type: "date", width: 110, accessor: (r2) => r2.voucher_date, cell: (r2) => fmtIndianDate(r2.voucher_date) },
    { id: "type", header: "Type", type: "enum", width: 130, accessor: (r2) => TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type, groupable: true },
    { id: "number", header: "No.", type: "text", width: 110, accessor: (r2) => r2.voucher_number },
    { id: "party", header: "Party", type: "text", width: 220, accessor: (r2) => r2.ledgers?.name ?? "", groupable: true, cell: (r2) => r2.ledgers?.name ?? "—" },
    { id: "narration", header: "Narration", type: "text", width: 260, accessor: (r2) => narrationOf(null, r2) },
    { id: "ref", header: "Ref", type: "text", width: 110, accessor: (r2) => r2.reference_no ?? "" },
    { id: "side", header: "Side", type: "enum", width: 70, accessor: (r2) => DR_TYPES.has(r2.voucher_type) ? "Dr" : CR_TYPES.has(r2.voucher_type) ? "Cr" : "Dr", groupable: true },
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
            onPrint={() => window.print()}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <QuickRangeChips from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={view === "t" ? "default" : "outline"}
                onClick={() => setView("t")}
              ><Columns2 className="mr-1 h-3.5 w-3.5" /> T-account</Button>
              <Button
                size="sm"
                variant={view === "grid" ? "default" : "outline"}
                onClick={() => setView("grid")}
              ><LayoutGrid className="mr-1 h-3.5 w-3.5" /> Grid</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-6"><EmptyState icon={BookOpen} title="No vouchers in range" description="Adjust the date filter or post some vouchers." /></CardContent></Card>
      ) : view === "t" ? (
        <TAccount
          title="Day Book"
          subtitle={`for the period ${from} to ${to}`}
          leftHeader="Dr.  Out / Purchases / Payments"
          rightHeader="Receipts / Sales  Cr."
          leftRows={drRows}
          rightRows={crRows}
          leftTotal={formatINR(drTotal)}
          rightTotal={formatINR(crTotal)}
        />
      ) : (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId="day-book"
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
