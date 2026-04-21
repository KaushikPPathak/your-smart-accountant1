import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/ledger")({
  head: () => ({ meta: [{ title: "Ledger Statement — Reports" }] }),
  component: LedgerStatement,
});

interface LedgerOpt {
  id: string;
  name: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

interface EntryRow {
  id: string;
  debit_paise: number;
  credit_paise: number;
  narration: string | null;
  vouchers: {
    id: string;
    voucher_date: string;
    voucher_number: string;
    voucher_type: string;
    narration: string | null;
  } | null;
}

function LedgerStatement() {
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [ledgerId, setLedgerId] = useState<string>("");
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [openingBeforeFrom, setOpeningBeforeFrom] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("ledgers")
      .select("id, name, opening_balance_paise, opening_balance_is_debit")
      .eq("company_id", activeCompanyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        const list = (data || []) as LedgerOpt[];
        setLedgers(list);
        if (!ledgerId && list[0]) setLedgerId(list[0].id);
      });
  }, [activeCompanyId, ledgerId]);

  const ledger = ledgers.find((l) => l.id === ledgerId);

  useEffect(() => {
    if (!ledgerId || !ledger) return;
    // entries within range
    supabase
      .from("voucher_entries")
      .select("id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, company_id)")
      .eq("ledger_id", ledgerId)
      .gte("vouchers.voucher_date", from)
      .lte("vouchers.voucher_date", to)
      .order("voucher_date", { referencedTable: "vouchers", ascending: true })
      .then(({ data }) => setEntries((data || []) as unknown as EntryRow[]));

    // sum entries strictly before "from" to compute opening for window
    supabase
      .from("voucher_entries")
      .select("debit_paise, credit_paise, vouchers!inner(voucher_date)")
      .eq("ledger_id", ledgerId)
      .lt("vouchers.voucher_date", from)
      .then(({ data }) => {
        const rows = (data || []) as { debit_paise: number; credit_paise: number }[];
        const movement = rows.reduce((s, r) => s + r.debit_paise - r.credit_paise, 0);
        const obSigned = (ledger.opening_balance_is_debit ? 1 : -1) * ledger.opening_balance_paise;
        setOpeningBeforeFrom(obSigned + movement);
      });
  }, [ledgerId, from, to, ledger]);

  const running = useMemo(() => {
    let bal = openingBeforeFrom;
    return entries.map((e) => {
      bal += e.debit_paise - e.credit_paise;
      return { ...e, balance: bal };
    });
  }, [entries, openingBeforeFrom]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({ dr: acc.dr + e.debit_paise, cr: acc.cr + e.credit_paise }),
      { dr: 0, cr: 0 },
    );
  }, [entries]);

  const closing = openingBeforeFrom + totals.dr - totals.cr;

  const fmtBal = (p: number) => `${formatINR(Math.abs(p))} ${p >= 0 ? "Dr" : "Cr"}`;

  const csvRows = (): (string | number)[][] => [
    [`Ledger: ${ledger?.name ?? ""}`, "", "", "", "", "", ""],
    [`Period: ${from} to ${to}`, "", "", "", "", "", ""],
    ["Date", "Voucher", "Type", "Narration", "Debit", "Credit", "Balance"],
    ["", "", "", "Opening", "", "", (openingBeforeFrom / 100).toFixed(2)],
    ...running.map((r2) => [
      r2.vouchers?.voucher_date ?? "",
      r2.vouchers?.voucher_number ?? "",
      r2.vouchers?.voucher_type ?? "",
      r2.narration ?? r2.vouchers?.narration ?? "",
      r2.debit_paise ? (r2.debit_paise / 100).toFixed(2) : "",
      r2.credit_paise ? (r2.credit_paise / 100).toFixed(2) : "",
      (r2.balance / 100).toFixed(2),
    ]),
    ["", "", "", "Totals", (totals.dr / 100).toFixed(2), (totals.cr / 100).toFixed(2), ""],
    ["", "", "", "Closing", "", "", (closing / 100).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`ledger-${ledger?.name ?? "x"}-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`ledger-${ledger?.name ?? "x"}-${from}_to_${to}.xlsx`, [
      { name: "Ledger", rows: csvRows() },
    ]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: `Ledger Statement — ${ledger?.name ?? ""}`,
      subtitle: `${from} to ${to}`,
      head: [["Date", "Voucher", "Type", "Narration", "Debit", "Credit", "Balance"]],
      body: [
        ["", "", "", "Opening", "", "", r(openingBeforeFrom).toFixed(2)],
        ...running.map((r2) => [
          r2.vouchers?.voucher_date ?? "",
          r2.vouchers?.voucher_number ?? "",
          r2.vouchers?.voucher_type ?? "",
          r2.narration ?? r2.vouchers?.narration ?? "",
          r2.debit_paise ? r(r2.debit_paise).toFixed(2) : "",
          r2.credit_paise ? r(r2.credit_paise).toFixed(2) : "",
          r(r2.balance).toFixed(2),
        ]),
      ],
      foot: [
        ["", "", "", "Totals", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
        ["", "", "", "Closing", "", "", r(closing).toFixed(2)],
      ],
      fileName: `ledger-${ledger?.name ?? "x"}-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [4, 5, 6],
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
            extra={
              <div className="space-y-1">
                <Label className="text-xs">Ledger</Label>
                <Select value={ledgerId} onValueChange={setLedgerId}>
                  <SelectTrigger className="h-9 w-[260px]">
                    <SelectValue placeholder="Select ledger" />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgers.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {!ledger ? (
            <div className="p-6 text-sm text-muted-foreground">Select a ledger to view its statement.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={4} className="font-medium text-muted-foreground">Opening Balance</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right font-mono">{fmtBal(openingBeforeFrom)}</TableCell>
                </TableRow>
                {running.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.vouchers?.voucher_date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.vouchers?.voucher_number}</TableCell>
                    <TableCell className="capitalize">{r.vouchers?.voucher_type.replace("_", " ")}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {r.narration ?? r.vouchers?.narration ?? ""}
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.debit_paise ? formatINR(r.debit_paise) : ""}</TableCell>
                    <TableCell className="text-right font-mono">{r.credit_paise ? formatINR(r.credit_paise) : ""}</TableCell>
                    <TableCell className="text-right font-mono">{fmtBal(r.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.dr)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.cr)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{fmtBal(closing)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
