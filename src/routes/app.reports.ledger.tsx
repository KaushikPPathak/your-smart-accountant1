import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ReportToolbar, defaultFyRange } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";

type LedgerSearch = { ledgerId?: string; from?: string; to?: string };

export const Route = createFileRoute("/app/reports/ledger")({
  head: () => ({ meta: [{ title: "Ledger Statement — Reports" }] }),
  validateSearch: (s: Record<string, unknown>): LedgerSearch => ({
    ledgerId: typeof s.ledgerId === "string" ? s.ledgerId : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
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
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const search = Route.useSearch();
  const initial = defaultFyRange();
  const [from, setFrom] = useState(search.from || initial.from);
  const [to, setTo] = useState(search.to || initial.to);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [ledgerId, setLedgerId] = useState<string>(search.ledgerId || "");
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

  useEffect(() => {
    if (search.ledgerId && search.ledgerId !== ledgerId) setLedgerId(search.ledgerId);
    if (search.from) setFrom(search.from);
    if (search.to) setTo(search.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ledgerId, search.from, search.to]);

  const ledger = ledgers.find((l) => l.id === ledgerId);

  useEffect(() => {
    if (!ledgerId || !ledger) return;
    supabase
      .from("voucher_entries")
      .select("id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, company_id)")
      .eq("ledger_id", ledgerId)
      .gte("vouchers.voucher_date", from)
      .lte("vouchers.voucher_date", to)
      .order("voucher_date", { referencedTable: "vouchers", ascending: true })
      .then(({ data }) => setEntries((data || []) as unknown as EntryRow[]));

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

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({ dr: acc.dr + e.debit_paise, cr: acc.cr + e.credit_paise }),
      { dr: 0, cr: 0 },
    );
  }, [entries]);

  const closing = openingBeforeFrom + totals.dr - totals.cr;

  // T-format split: opening goes on whichever side is natural,
  // each entry goes Dr or Cr depending on which has amount,
  // closing balance is shown as a "By/To Balance c/d" balancing entry.
  const drRows: TRow[] = [];
  const crRows: TRow[] = [];

  if (openingBeforeFrom > 0) {
    drRows.push({
      label: "To Opening Balance",
      hint: from,
      amount: formatINR(openingBeforeFrom),
      emphasis: "bold",
    });
  } else if (openingBeforeFrom < 0) {
    crRows.push({
      label: "By Opening Balance",
      hint: from,
      amount: formatINR(-openingBeforeFrom),
      emphasis: "bold",
    });
  }

  for (const e of entries) {
    const v = e.vouchers;
    const desc = e.narration || v?.narration || (v?.voucher_type ?? "").replace(/_/g, " ");
    const hint = v ? `${v.voucher_date} · ${v.voucher_number}` : "";
    const goto = v ? () => navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: v.id } }) : undefined;
    if (e.debit_paise > 0) {
      drRows.push({ label: <>To {desc}</>, hint, amount: formatINR(e.debit_paise), onClick: goto });
    }
    if (e.credit_paise > 0) {
      crRows.push({ label: <>By {desc}</>, hint, amount: formatINR(e.credit_paise), onClick: goto });
    }
  }

  // Balance c/d entry on the smaller side
  const drSubtotal = (openingBeforeFrom > 0 ? openingBeforeFrom : 0) + totals.dr;
  const crSubtotal = (openingBeforeFrom < 0 ? -openingBeforeFrom : 0) + totals.cr;
  if (drSubtotal > crSubtotal) {
    crRows.push({
      label: "By Balance c/d",
      hint: to,
      amount: formatINR(drSubtotal - crSubtotal),
      emphasis: "bold",
    });
  } else if (crSubtotal > drSubtotal) {
    drRows.push({
      label: "To Balance c/d",
      hint: to,
      amount: formatINR(crSubtotal - drSubtotal),
      emphasis: "bold",
    });
  }

  const grandTotal = Math.max(drSubtotal, crSubtotal);

  // Plain export rows derived from source data (not JSX TRow.label).
  type ExportRow = { label: string; paise: number };
  const drExport: ExportRow[] = [];
  const crExport: ExportRow[] = [];
  if (openingBeforeFrom > 0) drExport.push({ label: "To Opening Balance", paise: openingBeforeFrom });
  else if (openingBeforeFrom < 0) crExport.push({ label: "By Opening Balance", paise: -openingBeforeFrom });
  for (const e of entries) {
    const v = e.vouchers;
    const desc = e.narration || v?.narration || (v?.voucher_type ?? "").replace(/_/g, " ");
    const ref = v ? ` (${v.voucher_date} ${v.voucher_number})` : "";
    if (e.debit_paise > 0) drExport.push({ label: `To ${desc}${ref}`, paise: e.debit_paise });
    if (e.credit_paise > 0) crExport.push({ label: `By ${desc}${ref}`, paise: e.credit_paise });
  }
  if (drSubtotal > crSubtotal) crExport.push({ label: "By Balance c/d", paise: drSubtotal - crSubtotal });
  else if (crSubtotal > drSubtotal) drExport.push({ label: "To Balance c/d", paise: crSubtotal - drSubtotal });

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(drExport.length, crExport.length);
    return Array.from({ length: max }).map((_, i) => [
      drExport[i]?.label ?? "",
      drExport[i] ? r(drExport[i].paise).toFixed(2) : "",
      crExport[i]?.label ?? "",
      crExport[i] ? r(crExport[i].paise).toFixed(2) : "",
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`Ledger: ${ledger?.name ?? ""}`, "", "", ""],
    [`Period: ${from} to ${to}`, "", "", ""],
    ["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"],
    ...exportBody(),
    ["Total", r(grandTotal).toFixed(2), "Total", r(grandTotal).toFixed(2)],
    ["", "", "Closing", r(closing).toFixed(2)],
  ];

  const onExportCsv = () => downloadCsv(`ledger-${ledger?.name ?? "x"}-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`ledger-${ledger?.name ?? "x"}-${from}_to_${to}.xlsx`, [
      { name: "Ledger", rows: csvRows() },
    ]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: `Ledger A/c — ${ledger?.name ?? ""}`,
      subtitle: `${from} to ${to}`,
      head: [["Dr. Particulars", "Amount (₹)", "Cr. Particulars", "Amount (₹)"]],
      body: exportBody(),
      foot: [["Total", r(grandTotal).toFixed(2), "Total", r(grandTotal).toFixed(2)]],
      fileName: `ledger-${ledger?.name ?? "x"}-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [1, 3],
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
      {!ledger ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a ledger to view its statement.</CardContent></Card>
      ) : (
        <>
          <TAccount
            title={`${ledger.name} Account`}
            subtitle={`for the period ${from} to ${to}`}
            leftRows={drRows}
            rightRows={crRows}
            leftTotal={formatINR(grandTotal)}
            rightTotal={formatINR(grandTotal)}
          />
          <Card>
            <CardContent className="flex justify-between p-3 text-sm">
              <span className="text-muted-foreground">Closing balance</span>
              <span className="font-mono font-semibold">
                {formatINR(Math.abs(closing))} {closing >= 0 ? "Dr" : "Cr"}
              </span>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
