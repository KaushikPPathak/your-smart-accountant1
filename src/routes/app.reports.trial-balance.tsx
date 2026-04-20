import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";

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
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
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

  const totals = rows.reduce(
    (acc, r) => ({ dr: acc.dr + r.debit, cr: acc.cr + r.credit }),
    { dr: 0, cr: 0 },
  );

  const onExport = () => {
    const data: (string | number)[][] = [
      [`Trial Balance as on ${to}`, "", ""],
      ["Ledger", "Debit", "Credit"],
      ...rows
        .filter((r) => r.debit || r.credit)
        .map((r) => [r.name, r.debit ? (r.debit / 100).toFixed(2) : "", r.credit ? (r.credit / 100).toFixed(2) : ""]),
      ["Total", (totals.dr / 100).toFixed(2), (totals.cr / 100).toFixed(2)],
    ];
    downloadCsv(`trial-balance-${to}.csv`, data);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} onExport={onExport} onPrint={() => window.print()} />
          <p className="mt-2 text-xs text-muted-foreground">Closing balances as on <strong>{to}</strong> (opening balance + all postings up to date).</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ledger</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.filter((r) => r.debit || r.credit).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right font-mono">{r.debit ? formatINR(r.debit) : ""}</TableCell>
                  <TableCell className="text-right font-mono">{r.credit ? formatINR(r.credit) : ""}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.dr)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(totals.cr)}</TableCell>
              </TableRow>
              {totals.dr !== totals.cr && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-destructive">
                    ⚠ Difference: {formatINR(Math.abs(totals.dr - totals.cr))}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
