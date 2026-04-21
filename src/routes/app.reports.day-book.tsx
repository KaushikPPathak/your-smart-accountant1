import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
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

function DayBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    supabase
      .from("vouchers")
      .select("id, voucher_date, voucher_number, voucher_type, total_paise, narration, ledgers:party_ledger_id(name)")
      .eq("company_id", activeCompanyId)
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: true })
      .order("voucher_number", { ascending: true })
      .then(({ data }) => {
        setRows((data || []) as unknown as Row[]);
        setLoading(false);
      });
  }, [activeCompanyId, from, to]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);

  const csvRows = (): (string | number)[][] => [
    ["Date", "Type", "Number", "Party", "Narration", "Amount"],
    ...rows.map((r2) => [
      r2.voucher_date,
      TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type,
      r2.voucher_number,
      r2.ledgers?.name ?? "",
      r2.narration ?? "",
      (r2.total_paise / 100).toFixed(2),
    ]),
    ["", "", "", "", "Total", (total / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`day-book-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`day-book-${from}_to_${to}.xlsx`, [{ name: "Day Book", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: "Day Book",
      subtitle: `${from} to ${to}`,
      head: [["Date", "Type", "Number", "Party", "Narration", "Amount"]],
      body: rows.map((r2) => [
        r2.voucher_date,
        TYPE_LABEL[r2.voucher_type] ?? r2.voucher_type,
        r2.voucher_number,
        r2.ledgers?.name ?? "",
        r2.narration ?? "",
        r(r2.total_paise).toFixed(2),
      ]),
      foot: [["", "", "", "", "Total", r(total).toFixed(2)]],
      fileName: `day-book-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [5],
    });

  return (
    <div className="space-y-3">
      <Card>
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
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={BookOpen} title="No vouchers in range" description="Adjust the date filter or post some vouchers." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: r.id } })}
                    title="Click to edit"
                  >
                    <TableCell>{r.voucher_date}</TableCell>
                    <TableCell>{TYPE_LABEL[r.voucher_type] ?? r.voucher_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voucher_number}</TableCell>
                    <TableCell>{r.ledgers?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted-foreground">{r.narration ?? ""}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold">Total</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
