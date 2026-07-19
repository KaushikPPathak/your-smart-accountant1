import { openVoucherDetail } from "@/lib/voucher-return";
import { fmtIndianDate } from "@/lib/format-date";
import { sortEntriesByVoucherAsc } from "@/lib/voucher-sort";
import { narrationOf, hasAnyNarration } from "@/lib/voucher-text";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { EmptyState } from "@/components/EmptyState";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { getLedger, useMastersVersion, getAllLedgers } from "@/lib/masters-cache";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { readLedgers, readVoucherEntriesWithVouchers, withCacheFallback } from "@/lib/offline/cache-read";

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
    reference_no: string | null;
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
  const pdfHeader = useReportPdfHeader();
  const { view, setView } = useReportView("cash-bank");
  const search = Route.useSearch();
  const { from, to, setFrom, setTo } = useFyRangeState(search.from, search.to);
  const mastersVersion = useMastersVersion();
  const [offlineLedgers, setOfflineLedgers] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const masterCashBankLedgers = useMemo(
    () => getAllLedgers().filter((l) => l.type === "cash" || l.type === "bank"),
    [mastersVersion],
  );
  const offlineCashBankLedgers = useMemo(
    () => offlineLedgers.filter((l) => l.type === "cash" || l.type === "bank"),
    [offlineLedgers],
  );
  const cashBankLedgers = masterCashBankLedgers.length > 0 ? masterCashBankLedgers : offlineCashBankLedgers;
  const ledgerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of offlineLedgers) map.set(l.id, l.name);
    for (const l of getAllLedgers()) map.set(l.id, l.name);
    return map;
  }, [mastersVersion, offlineLedgers]);
  const [ledgerId, setLedgerId] = useState<string>(search.ledgerId || "");
  useEffect(() => {
    if (masterCashBankLedgers.length > 0 || !activeCompanyId) return;
    let cancelled = false;
    void readLedgers(activeCompanyId).then((rows) => {
      if (cancelled) return;
      setOfflineLedgers((rows as any[])
        .filter((l) => l.is_active !== false)
        .map((l) => ({ id: String(l.id), name: String(l.name ?? ""), type: String(l.type ?? "") })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeCompanyId, masterCashBankLedgers.length]);
  useEffect(() => {
    if (!ledgerId && cashBankLedgers[0]) setLedgerId(cashBankLedgers[0].id);
  }, [ledgerId, cashBankLedgers]);

  // Mirror the current selection into the URL so that going back from a
  // drilled voucher restores the same ledger + date range (the report
  // component re-mounts on back nav and reads its initial state from the
  // URL search params).
  useEffect(() => {
    if (!ledgerId) return;
    if (search.ledgerId === ledgerId && search.from === from && search.to === to) return;
    void navigate({
      to: "/app/reports/cash-bank",
      search: { ledgerId, from, to },
      replace: true,
    });
  }, [ledgerId, from, to, search.ledgerId, search.from, search.to, navigate]);

  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [siblings, setSiblings] = useState<Map<string, SiblingRow[]>>(new Map());
  const [opening, setOpening] = useState(0);
  const [loading, setLoading] = useState(false);

  const ledger = getLedger(ledgerId);
  const selectedCashBankLedger = cashBankLedgers.find((l) => l.id === ledgerId);
  const selectedLedgerName = ledger?.name ?? selectedCashBankLedger?.name ?? "";
  const selectedLedgerType = ledger?.type ?? selectedCashBankLedger?.type ?? "";

  // Load opening (paise) for the chosen ledger from base ledger row
  useEffect(() => {
    if (!ledgerId || !activeCompanyId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const base = await withCacheFallback<{ opening_balance_paise: number; opening_balance_is_debit: boolean } | null>(
        async () => {
          const { data, error } = await supabase
            .from("ledgers")
            .select("opening_balance_paise, opening_balance_is_debit")
            .eq("id", ledgerId)
            .maybeSingle();
          if (error) throw error;
          return data as { opening_balance_paise: number; opening_balance_is_debit: boolean } | null;
        },
        async () => {
          const row = (await readLedgers(activeCompanyId)).find((l: any) => String(l.id) === ledgerId) as any;
          return row ? {
            opening_balance_paise: Number(row.opening_balance_paise ?? 0),
            opening_balance_is_debit: Boolean(row.opening_balance_is_debit),
          } : null;
        },
      );
      const ob = base
        ? (base.opening_balance_is_debit ? 1 : -1) * base.opening_balance_paise
        : 0;
      const prior = await withCacheFallback<{ debit_paise: number; credit_paise: number }[]>(
        async () => {
          const { data, error } = await supabase
            .from("voucher_entries")
            .select("debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
            .eq("ledger_id", ledgerId)
            .eq("vouchers.company_id", activeCompanyId)
            .lt("vouchers.voucher_date", from);
          if (error) throw error;
          return (data || []) as { debit_paise: number; credit_paise: number }[];
        },
        async () => (await readVoucherEntriesWithVouchers(activeCompanyId, { ledgerId, before: from })) as { debit_paise: number; credit_paise: number }[],
      );
      const movement = prior.reduce(
        (s, e) => s + (e.debit_paise as number) - (e.credit_paise as number),
        0,
      );
      if (cancelled) return;
      setOpening(ob + movement);

      const list = await withCacheFallback<EntryRow[]>(
        async () => {
          const { data, error } = await supabase
            .from("voucher_entries")
            .select("id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, reference_no, company_id)")
            .eq("ledger_id", ledgerId)
            .eq("vouchers.company_id", activeCompanyId)
            .gte("vouchers.voucher_date", from)
            .lte("vouchers.voucher_date", to)
            .order("voucher_date", { referencedTable: "vouchers", ascending: true }).order("voucher_number", { referencedTable: "vouchers", ascending: true });
          if (error) throw error;
          return (data || []) as unknown as EntryRow[];
        },
        async () => (await readVoucherEntriesWithVouchers(activeCompanyId, { ledgerId, from, to })) as EntryRow[],
      );
      if (cancelled) return;
      setEntries(list);

      const ids = list.map((e) => e.vouchers?.id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setSiblings(new Map());
      } else {
        const sibs = await withCacheFallback<SiblingRow[]>(
          async () => {
            const { data, error } = await supabase
              .from("voucher_entries")
              .select("voucher_id, ledger_id, debit_paise, credit_paise")
              .in("voucher_id", ids)
              .neq("ledger_id", ledgerId);
            if (error) throw error;
            return (data || []) as SiblingRow[];
          },
          async () => ((await readVoucherEntriesWithVouchers(activeCompanyId)) as any[])
            .filter((e) => ids.includes(String(e.voucher_id)) && String(e.ledger_id) !== ledgerId)
            .map((e) => ({
              voucher_id: String(e.voucher_id),
              ledger_id: String(e.ledger_id),
              debit_paise: Number(e.debit_paise ?? 0),
              credit_paise: Number(e.credit_paise ?? 0),
            })),
        );
        const map = new Map<string, SiblingRow[]>();
        for (const s of sibs) {
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
    const sorted = sortEntriesByVoucherAsc(entries);
    let bal = opening;
    for (const e of sorted) {
      const v = e.vouchers;
      if (!v) continue;
      const sibs = siblings.get(v.id) ?? [];
      // Particulars = the contra ledger(s)
      const partyNames = sibs
        .map((s) => getLedger(s.ledger_id)?.name ?? ledgerNameById.get(s.ledger_id))
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
        narration: narrationOf(e, v),
        debit: e.debit_paise,
        credit: e.credit_paise,
        balance: bal,
      });
    }
    return out;
  }, [entries, siblings, opening, ledgerNameById]);

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
        fmtIndianDate(row.date),
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

  const fileBase = `cash-bank-${selectedLedgerName || "x"}-${from}_to_${to}`;
  const onExportCsv = () => downloadCsv(`${fileBase}.csv`, csvRows());
  const onExportXlsx = () => downloadXlsx(`${fileBase}.xlsx`, [{ name: "Cash & Bank", rows: csvRows() }]);
  const onExportPdf = () => {
    const showNarr = hasAnyNarration(rows);
    const head = showNarr
      ? ["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"]
      : ["Date", "Particulars", "Vch Type", "Vch No", "Debit", "Credit", "Balance"];
    const opening_row = showNarr
      ? ["", "Opening Balance", "", "", "", "", "", fmtBal(opening)]
      : ["", "Opening Balance", "", "", "", "", fmtBal(opening)];
    const bodyRows = rows.map((row) => {
      const base = [
        fmtIndianDate(row.date),
        row.particulars,
        row.vchType,
        row.vchNo,
      ];
      const tail = [
        row.debit ? r(row.debit).toFixed(2) : "",
        row.credit ? r(row.credit).toFixed(2) : "",
        fmtBal(row.balance),
      ];
      return showNarr ? [...base, row.narration, ...tail] : [...base, ...tail];
    });
    const foot = showNarr
      ? [
          ["Total", "", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
          ["Closing Balance", "", "", "", "", "", "", fmtBal(closing)],
        ]
      : [
          ["Total", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
          ["Closing Balance", "", "", "", "", "", fmtBal(closing)],
        ];
    downloadPdfTable({
      title: selectedLedgerName || "Cash & Bank Book",
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      head: [head],
      body: [opening_row, ...bodyRows],
      foot,
      fileName: `${fileBase}.pdf`,
      orientation: "l",
      rightAlignCols: showNarr ? [5, 6, 7] : [4, 5, 6],
    });
  };

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
            <div className="flex flex-wrap items-end gap-3">
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
              <div className="space-y-1">
                <Label className="text-xs">View</Label>
                <ViewSwitcher view={view} onChange={setView} />
              </div>
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

  const accountHeading = selectedLedgerName
    ? selectedLedgerType === "cash"
      ? `Cash Book${selectedLedgerName ? `: ${selectedLedgerName}` : ""}`
      : `Bank Book: ${selectedLedgerName}`
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
      ) : view === "grid" ? (
        <Card className="overflow-hidden">
          <CardContent className="p-3">
            <DataGrid<typeof rows[number]>
              reportId={`cash-bank:${ledgerId}`}
              rows={rows}
              columns={[
                { id: "date", header: "Date", type: "date", width: 110, accessor: (x) => x.date, cell: (x) => fmtIndianDate(x.date) },
                { id: "particulars", header: "Particulars", type: "text", width: 240, accessor: (x) => x.particulars, groupable: true },
                { id: "vchType", header: "Vch Type", type: "enum", width: 110, accessor: (x) => x.vchType, groupable: true },
                { id: "vchNo", header: "Vch No", type: "text", width: 110, accessor: (x) => x.vchNo },
                { id: "narration", header: "Narration", type: "text", width: 260, accessor: (x) => x.narration },
                { id: "debit", header: "Debit", type: "number", width: 130, align: "right", accessor: (x) => x.debit / 100, cell: (x) => x.debit ? formatINR(x.debit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
                { id: "credit", header: "Credit", type: "number", width: 130, align: "right", accessor: (x) => x.credit / 100, cell: (x) => x.credit ? formatINR(x.credit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
                { id: "balance", header: "Balance", type: "number", width: 140, align: "right", accessor: (x) => x.balance / 100, cell: (x) => fmtBal(x.balance) },
              ] satisfies DGColumn<typeof rows[number]>[]}
              onRowClick={(r2) => openVoucherDetail(navigate, r2.voucherId)}
              globalSearch={(r2) => `${r2.particulars} ${r2.vchType} ${r2.vchNo} ${r2.narration}`}
              footerLabel={`Opening ${fmtBal(opening)} • Closing ${fmtBal(closing)}`}
              height={520}
            />
          </CardContent>
        </Card>
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
                      onClick={() => openVoucherDetail(navigate, row.voucherId)}
                    >
                      <td className="border-b border-border/60 p-2 whitespace-nowrap">{fmtIndianDate(row.date)}</td>
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
