import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

export const Route = createFileRoute("/app/reports/receivables")({
  head: () => ({ meta: [{ title: "Outstanding Receivables — Reports" }] }),
  component: () => <Outstanding mode="receivables" />,
});

interface Ledger {
  id: string;
  name: string;
  type: string;
  credit_days: number;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

interface Entry {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string } | null;
}

const BUCKETS = [
  { label: "0–30", lo: 0, hi: 30 },
  { label: "31–60", lo: 31, hi: 60 },
  { label: "61–90", lo: 61, hi: 90 },
  { label: "90+", lo: 91, hi: Infinity },
];

export function Outstanding({ mode }: { mode: "receivables" | "payables" }) {
  const { activeCompanyId } = useCompany();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  const isRecv = mode === "receivables";
  const partyType = isRecv ? "sundry_debtor" : "sundry_creditor";

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("ledgers")
      .select("id, name, type, credit_days, opening_balance_paise, opening_balance_is_debit")
      .eq("company_id", activeCompanyId)
      .eq("type", partyType)
      .order("name")
      .then(({ data }) => setLedgers((data || []) as Ledger[]));
  }, [activeCompanyId, partyType]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("voucher_entries")
      .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
      .eq("vouchers.company_id", activeCompanyId)
      .lte("vouchers.voucher_date", to)
      .then(({ data }) => setEntries((data || []) as unknown as Entry[]));
  }, [activeCompanyId, to]);

  const today = new Date(to);

  const rows = useMemo(() => {
    return ledgers
      .map((l) => {
        const obSigned = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
        const ledgerEntries = entries.filter((e) => e.ledger_id === l.id);
        const movement = ledgerEntries.reduce((s, e) => s + e.debit_paise - e.credit_paise, 0);
        const closing = obSigned + movement;
        // Receivable: positive (Dr); Payable: negative (Cr) → flip sign
        const outstanding = isRecv ? closing : -closing;
        if (outstanding <= 0) return null;

        // Estimate "oldest open" using earliest unmatched debit (recv) or credit (pay).
        // Simplification: oldest voucher with same-side amount on this ledger within window.
        const openSide = ledgerEntries
          .filter((e) => (isRecv ? e.debit_paise > 0 : e.credit_paise > 0))
          .map((e) => e.vouchers?.voucher_date)
          .filter((d): d is string => !!d)
          .sort();
        const oldestDate = openSide[0] ?? null;
        const days = oldestDate
          ? Math.floor((today.getTime() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const overdue = Math.max(0, days - (l.credit_days || 0));
        const buckets = BUCKETS.map((b) =>
          days >= b.lo && days <= b.hi ? outstanding : 0,
        );
        return { id: l.id, name: l.name, days, credit_days: l.credit_days, overdue, outstanding, buckets, oldestDate };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [ledgers, entries, today, isRecv]);

  const totalOut = rows.reduce((s, x) => s + x.outstanding, 0);
  const totalsByBucket = BUCKETS.map((_, i) => rows.reduce((s, x) => s + x.buckets[i], 0));

  const head = ["Party", "Oldest", "Days", "Credit Days", "Overdue", ...BUCKETS.map((b) => b.label), "Total"];
  const csvBody = (): (string | number)[][] => [
    head,
    ...rows.map((x) => [
      x.name,
      x.oldestDate ?? "",
      x.days,
      x.credit_days,
      x.overdue,
      ...x.buckets.map((b) => (b ? (b / 100).toFixed(2) : "")),
      (x.outstanding / 100).toFixed(2),
    ]),
    ["TOTAL", "", "", "", "", ...totalsByBucket.map((b) => (b / 100).toFixed(2)), (totalOut / 100).toFixed(2)],
  ];

  const title = isRecv ? "Outstanding Receivables" : "Outstanding Payables";
  const slug = isRecv ? "receivables" : "payables";

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={() => downloadCsv(`${slug}-${to}.csv`, csvBody())}
            onExportXlsx={() => downloadXlsx(`${slug}-${to}.xlsx`, [{ name: title, rows: csvBody() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title,
                subtitle: `As on ${to}`,
                head: [head],
                body: rows.map((x) => [
                  x.name,
                  x.oldestDate ?? "",
                  String(x.days),
                  String(x.credit_days),
                  String(x.overdue),
                  ...x.buckets.map((b) => (b ? r(b).toFixed(2) : "")),
                  r(x.outstanding).toFixed(2),
                ]),
                foot: [["TOTAL", "", "", "", "", ...totalsByBucket.map((b) => r(b).toFixed(2)), r(totalOut).toFixed(2)]],
                fileName: `${slug}-${to}.pdf`,
                orientation: "l",
                rightAlignCols: [2, 3, 4, 5, 6, 7, 8, 9],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">As on <strong>{to}</strong>. Aging buckets are based on the oldest open voucher date.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Party</TableHead>
                <TableHead>Oldest</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Credit Days</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                {BUCKETS.map((b) => (
                  <TableHead key={b.label} className="text-right">{b.label}</TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                    Nothing outstanding.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{x.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{x.oldestDate ?? "—"}</TableCell>
                  <TableCell className="text-right">{x.days}</TableCell>
                  <TableCell className="text-right">{x.credit_days}</TableCell>
                  <TableCell className={`text-right ${x.overdue > 0 ? "text-destructive font-semibold" : ""}`}>{x.overdue}</TableCell>
                  {x.buckets.map((b, i) => (
                    <TableCell key={i} className="text-right font-mono">{b ? formatINR(b) : ""}</TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-semibold">{formatINR(x.outstanding)}</TableCell>
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold">TOTAL</TableCell>
                  {totalsByBucket.map((b, i) => (
                    <TableCell key={i} className="text-right font-mono font-semibold">{b ? formatINR(b) : ""}</TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totalOut)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
