import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { EmptyState } from "@/components/EmptyState";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { getLedger, useMastersVersion, getAllLedgers } from "@/lib/masters-cache";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";

type Search = { ledgerId?: string; from?: string; to?: string };

export const Route = createFileRoute("/app/reports/cash-bank")({
  head: () => ({ meta: [{ title: "Cash & Bank Book — Reports" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    ledgerId: typeof s.ledgerId === "string" ? s.ledgerId : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
  component: CashBankBook,
});

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
  // sibling entries to determine "particulars" (the contra ledger)
}

interface SiblingRow {
  voucher_id: string;
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
}

const TYPE_LABEL: Record<string, string> = {
  sales: "Sales",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  journal: "Journal",
  contra: "Contra",
  credit_note: "Cr Note",
  debit_note: "Dr Note",
};

function CashBankBook() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const search = Route.useSearch();
  const { from, to, setFrom, setTo } = useFyRangeState(search.from, search.to);
  const mastersVersion = useMastersVersion();
  const cashBankLedgers = useMemo(
    () => getAllLedgers().filter((l) => l.type === "cash" || l.type === "bank"),
    [mastersVersion],
  );
  const [ledgerId, setLedgerId] = useState<string>(search.ledgerId || "");
  useEffect(() => {
    if (!ledgerId && cashBankLedgers[0]) setLedgerId(cashBankLedgers[0].id);
  }, [ledgerId, cashBankLedgers]);

  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [siblings, setSiblings] = useState<Map<string, SiblingRow[]>>(new Map());
  const [opening, setOpening] = useState(0);
  const [loading, setLoading] = useState(false);

  const ledger = getLedger(ledgerId);

  // Load opening (paise) for the chosen ledger from base ledger row
  useEffect(() => {
    if (!ledgerId || !activeCompanyId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data: base } = await supabase
        .from("ledgers")
        .select("opening_balance_paise, opening_balance_is_debit")
        .eq("id", ledgerId)
        .maybeSingle();
      const ob = base
        ? (base.opening_balance_is_debit ? 1 : -1) * base.opening_balance_paise
        : 0;
      const { data: prior } = await supabase
        .from("voucher_entries")
        .select("debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
        .eq("ledger_id", ledgerId)
        .eq("vouchers.company_id", activeCompanyId)
        .lt("vouchers.voucher_date", from);
      const movement = (prior || []).reduce(
        (s, e) => s + (e.debit_paise as number) - (e.credit_paise as number),
        0,
      );
      if (cancelled) return;
      setOpening(ob + movement);

      const { data: ent } = await supabase
        .from("voucher_entries")
        .select("id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, company_id)")
        .eq("ledger_id", ledgerId)
        .eq("vouchers.company_id", activeCompanyId)
        .gte("vouchers.voucher_date", from)
        .lte("vouchers.voucher_date", to)
        .order("voucher_date", { referencedTable: "vouchers", ascending: true });
      const list = (ent || []) as unknown as EntryRow[];
      if (cancelled) return;
      setEntries(list);

      const ids = list.map((e) => e.vouchers?.id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setSiblings(new Map());
      } else {
        const { data: sibs } = await supabase
          .from("voucher_entries")
          .select("voucher_id, ledger_id, debit_paise, credit_paise")
          .in("voucher_id", ids)
          .neq("ledger_id", ledgerId);
        const map = new Map<string, SiblingRow[]>();
        for (const s of (sibs || []) as SiblingRow[]) {
          const arr = map.get(s.voucher_id) ?? [];
          arr.push(s);
          map.set(s.voucher_id, arr);
        }
        if (cancelled) return;
        setSiblings(map);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ledgerId, activeCompanyId, from, to]);

  // Build rows in a single pass with running balance — integer (paise) math.
  const rows = useMemo(() => {
    type R = {
      key: string;
      voucherId: string;
      date: string;
      particulars: string;
      vchType: string;
      vchNo: string;
      narration: string;
      debit: number;
      credit: number;
      balance: number;
    };
    const out: R[] = [];
    let bal = opening;
    for (const e of entries) {
      const v = e.vouchers;
      if (!v) continue;
      const sibs = siblings.get(v.id) ?? [];
      // Particulars = the contra ledger(s)
      const partyNames = sibs
        .map((s) => getLedger(s.ledger_id)?.name)
        .filter(Boolean) as string[];
      const particulars = partyNames.length ? partyNames.join(", ") : "—";
      bal = bal + e.debit_paise - e.credit_paise;
      out.push({
        key: e.id,
        voucherId: v.id,
        date: v.voucher_date,
        particulars,
        vchType: TYPE_LABEL[v.voucher_type] ?? v.voucher_type,
        vchNo: v.voucher_number,
        narration: e.narration ?? v.narration ?? "",
        debit: e.debit_paise,
        credit: e.credit_paise,
        balance: bal,
      });
    }
    return out;
  }, [entries, siblings, opening]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const row of rows) {
      dr += row.debit;
      cr += row.credit;
    }
    return { dr, cr };
  }, [rows]);

  const closing = opening + totals.dr - totals.cr;

  const fmtBal = (paise: number) =>
    `${formatINR(Math.abs(paise), { symbol: false })} ${paise >= 0 ? "Dr" : "Cr"}`;

  // ---------- Exports ----------
  const csvRows = (): (string | number)[][] => {
    const head = ["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"];
    const body: (string | number)[][] = [
      ["Opening Balance", "", "", "", "", "", "", fmtBal(opening)],
      ...rows.map((row) => [
        row.date,
        row.particulars,
        row.vchType,
        row.vchNo,
        row.narration,
        row.debit ? r(row.debit).toFixed(2) : "",
        row.credit ? r(row.credit).toFixed(2) : "",
        fmtBal(row.balance),
      ]),
      ["Total", "", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
      ["Closing Balance", "", "", "", "", "", "", fmtBal(closing)],
    ];
    return [head, ...body];
  };

  const fileBase = `cash-bank-${ledger?.name ?? "x"}-${from}_to_${to}`;
  const onExportCsv = () => downloadCsv(`${fileBase}.csv`, csvRows());
  const onExportXlsx = () => downloadXlsx(`${fileBase}.xlsx`, [{ name: "Cash & Bank", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: `Cash & Bank Book — ${ledger?.name ?? ""}`,
      subtitle: `${from} to ${to}`,
      head: [["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"]],
      body: [
        ["", "Opening Balance", "", "", "", "", "", fmtBal(opening)],
        ...rows.map((row) => [
          row.date,
          row.particulars,
          row.vchType,
          row.vchNo,
          row.narration,
          row.debit ? r(row.debit).toFixed(2) : "",
          row.credit ? r(row.credit).toFixed(2) : "",
          fmtBal(row.balance),
        ]),
      ],
      foot: [
        ["Total", "", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
        ["Closing Balance", "", "", "", "", "", "", fmtBal(closing)],
      ],
      fileName: `${fileBase}.pdf`,
      orientation: "l",
      rightAlignCols: [5, 6, 7],
    });

  const toolbar = (
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
              <Label className="text-xs">Cash / Bank Ledger</Label>
              <Select value={ledgerId} onValueChange={setLedgerId}>
                <SelectTrigger className="h-9 w-[260px]">
                  <SelectValue placeholder="Select ledger" />
                </SelectTrigger>
                <SelectContent>
                  {cashBankLedgers.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} ({l.type === "cash" ? "Cash" : "Bank"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </CardContent>
    </Card>
  );

  if (cashBankLedgers.length === 0) {
    return (
      <ReportViewer title="Cash & Bank Book" toolbar={toolbar} fromDate={from} toDate={to}>
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={Wallet}
              title="No Cash or Bank ledger"
              description="Create a Cash or Bank ledger to view this book."
            />
          </CardContent>
        </Card>
      </ReportViewer>
    );
  }

  const accountHeading = ledger
    ? ledger.type === "cash"
      ? `Cash Book${ledger.name ? `: ${ledger.name}` : ""}`
      : `Bank Book: ${ledger.name}`
    : "Cash & Bank Book";

  return (
    <ReportViewer
      title="Cash & Bank Book"
      accountHeading={accountHeading}
      fromDate={from}
      toDate={to}
      toolbar={toolbar}
      orientation="landscape"
      onExportPdf={onExportPdf}
      exportFileBase={fileBase}
    >
      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : !ledger ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a Cash or Bank ledger.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="border-b border-border p-2 text-left">Date</th>
                  <th className="border-b border-border p-2 text-left">Particulars</th>
                  <th className="border-b border-border p-2 text-left">Vch Type</th>
                  <th className="border-b border-border p-2 text-left">Vch No</th>
                  <th className="border-b border-border p-2 text-left">Narration</th>
                  <th className="border-b border-border p-2 num">Debit</th>
                  <th className="border-b border-border p-2 num">Credit</th>
                  <th className="border-b border-border p-2 num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="row-bold bg-muted/30">
                  <td className="border-b border-border p-2" colSpan={7}>
                    <span className="font-semibold">Opening Balance</span>
                  </td>
                  <td className="border-b border-border p-2 num font-semibold">{fmtBal(opening)}</td>
                </tr>
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-muted-foreground" colSpan={8}>
                      No entries in this period.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: row.voucherId } })
                      }
                    >
                      <td className="border-b border-border/60 p-2 whitespace-nowrap">{row.date}</td>
                      <td className="border-b border-border/60 p-2">{row.particulars}</td>
                      <td className="border-b border-border/60 p-2 whitespace-nowrap">{row.vchType}</td>
                      <td className="border-b border-border/60 p-2 whitespace-nowrap">{row.vchNo}</td>
                      <td className="border-b border-border/60 p-2 narration-cell text-muted-foreground">{row.narration}</td>
                      <td className="border-b border-border/60 p-2 num">{row.debit ? formatINR(row.debit, { symbol: false }) : ""}</td>
                      <td className="border-b border-border/60 p-2 num">{row.credit ? formatINR(row.credit, { symbol: false }) : ""}</td>
                      <td className="border-b border-border/60 p-2 num">{fmtBal(row.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="row-bold bg-muted/50">
                  <td className="p-2 font-semibold" colSpan={5}>Total</td>
                  <td className="p-2 num font-semibold">{formatINR(totals.dr, { symbol: false })}</td>
                  <td className="p-2 num font-semibold">{formatINR(totals.cr, { symbol: false })}</td>
                  <td className="p-2"></td>
                </tr>
                <tr className="row-bold bg-muted/30">
                  <td className="p-2 font-semibold" colSpan={7}>Closing Balance</td>
                  <td className="p-2 num font-semibold">{fmtBal(closing)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}
    </ReportViewer>
  );
}
