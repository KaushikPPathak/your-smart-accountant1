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
import { BookOpen } from "lucide-react";

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

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    supabase
      .from("vouchers")
      .select("id, voucher_date, voucher_number, voucher_type, total_paise, narration, reference_no, ledgers:party_ledger_id(name)")
      .eq("company_id", activeCompanyId)
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true })
      .then(({ data }) => {
        setRows(sortVouchersAsc((data || []) as unknown as Row[]));
        setLoading(false);
      });
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
        </CardContent>
      </Card>
      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-6"><EmptyState icon={BookOpen} title="No vouchers in range" description="Adjust the date filter or post some vouchers." /></CardContent></Card>
      ) : (
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
      )}
    </div>
  );
}
