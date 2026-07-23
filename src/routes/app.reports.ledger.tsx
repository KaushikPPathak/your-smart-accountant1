import { openVoucherDetail, hasLedgerOrigin, goBackFromLedger } from "@/lib/voucher-return";
import { useReportUrlSync } from "@/lib/report-url-state";
import { amountHeader } from "@/lib/export-format";
import { sortEntriesByVoucherAsc } from "@/lib/voucher-sort";
import { narrationOf } from "@/lib/voucher-text";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useShortcut } from "@/lib/keyboard";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { TAccountColumnar, type TColRow } from "@/components/reports/TAccountColumnar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadPdfMultiTable, downloadXlsx, r, type PdfSection } from "@/lib/exporters";
import { exportHtmlAsWord } from "@/lib/word-export";
import { fmtIndianDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { FileText, Eye, FileType2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { readLedgers, readVoucherEntriesWithVouchers, withCacheFallback } from "@/lib/offline/cache-read";
import { offlineDb } from "@/lib/offline/db";

/**
 * Step 2c — zero-risk fast path for Ledger Statement.
 *
 * Uses the v8 compound index [company_id+ledger_id] on cache_voucher_entries
 * to fetch only entries for the selected ledger, then loads just the
 * referenced vouchers (by id) and applies date filters. This avoids scanning
 * every entry + every voucher for the company.
 *
 * On ANY failure it throws; caller falls back to readVoucherEntriesWithVouchers.
 */
async function readLedgerEntriesFast(
  companyId: string,
  ledgerId: string,
  opts: { from?: string; to?: string; before?: string },
): Promise<any[]> {
  const entries = await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, ledgerId])
    .toArray();
  const liveEntries = (entries as any[]).filter((e) => e?.is_deleted !== true);
  const voucherIds = Array.from(new Set(liveEntries.map((e) => String(e.voucher_id))));
  if (voucherIds.length === 0) return [];
  const vouchers: any[] = [];
  for (let i = 0; i < voucherIds.length; i += 500) {
    const chunk = voucherIds.slice(i, i + 500);
    const rows = await offlineDb.cache_vouchers.where("id").anyOf(chunk).toArray();
    for (const v of rows as any[]) {
      if (v?.is_deleted !== true) vouchers.push(v);
    }
  }
  const voucherById = new Map(vouchers.map((v) => [String(v.id), v]));
  return liveEntries
    .map((e) => {
      const v = voucherById.get(String(e.voucher_id));
      if (!v) return null;
      const voucherDate = String(v.voucher_date ?? v.date ?? "");
      if (opts.from && voucherDate < opts.from) return null;
      if (opts.to && voucherDate > opts.to) return null;
      if (opts.before && voucherDate >= opts.before) return null;
      return {
        ...e,
        vouchers: {
          id: String(v.id),
          voucher_date: voucherDate,
          voucher_number: String(v.voucher_number ?? ""),
          voucher_type: String(v.voucher_type ?? ""),
          narration: v.narration ?? null,
          reference_no: v.reference_no ?? null,
          company_id: companyId,
        },
      };
    })
    .filter(Boolean) as any[];
}

type ViewMode = "columnar" | "horizontal" | "grid";
type LedgerSearch = { ledgerId?: string; from?: string; to?: string; view?: ViewMode };

export const Route = createFileRoute("/app/reports/ledger")({
  head: () => ({ meta: [{ title: "Ledger Statement — Reports" }] }),
  validateSearch: (s: Record<string, unknown>): LedgerSearch => ({
    ledgerId: typeof s.ledgerId === "string" ? s.ledgerId : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
    view: s.view === "horizontal" ? "horizontal" : s.view === "grid" ? "grid" : s.view === "columnar" ? "columnar" : undefined,
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
    reference_no: string | null;
  } | null;
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


function LedgerStatement() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const search = Route.useSearch();
  const { from, to, setFrom, setTo } = useFyRangeState(search.from, search.to);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [ledgerId, setLedgerId] = useState<string>(search.ledgerId || "");
  const [view, setView] = useState<ViewMode>(search.view ?? "columnar");
  const [pdfFormat, setPdfFormat] = useState<"standard" | "confirmation" | "ageing">("standard");
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [siblings, setSiblings] = useState<Map<string, SiblingRow[]>>(new Map());
  const [siblingNames, setSiblingNames] = useState<Map<string, { name: string; type: string }>>(new Map());
  const [openingBeforeFrom, setOpeningBeforeFrom] = useState(0);
  const [showBack, setShowBack] = useState(false);
  useEffect(() => { setShowBack(hasLedgerOrigin()); }, []);

  // Esc returns to the originating screen (Alt+L launcher or drill-down).
  useShortcut(
    "Escape",
    (e) => {
      if (hasLedgerOrigin()) {
        e.preventDefault();
        goBackFromLedger(() => navigate({ to: "/app/reports" }));
        return;
      }
      let back: string | null = null;
      try { back = sessionStorage.getItem("ledgerReturnTo"); } catch { /* ignore */ }
      if (back && back !== "/app/reports/ledger") {
        try { sessionStorage.removeItem("ledgerReturnTo"); } catch { /* ignore */ }
        e.preventDefault();
        window.history.back();
      }
    },
    { scope: "report", description: "Back to previous report" },
  );


  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    void withCacheFallback(
      async () => {
        const { data, error } = await supabase
          .from("ledgers")
          .select("id, name, opening_balance_paise, opening_balance_is_debit")
          .eq("company_id", activeCompanyId)
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        return (data || []) as LedgerOpt[];
      },
      async () => (await readLedgers(activeCompanyId))
        .filter((l: any) => l.is_active !== false)
        .map((l: any) => ({
          id: String(l.id),
          name: String(l.name ?? ""),
          opening_balance_paise: Number(l.opening_balance_paise ?? 0),
          opening_balance_is_debit: Boolean(l.opening_balance_is_debit),
        })),
    ).then((list) => {
        if (cancelled) return;
        setLedgers(list);
        if (!ledgerId && list[0]) setLedgerId(list[0].id);
      });
    return () => { cancelled = true; };
  }, [activeCompanyId, ledgerId]);

  useEffect(() => {
    if (search.ledgerId && search.ledgerId !== ledgerId) setLedgerId(search.ledgerId);
    if (search.from) setFrom(search.from);
    if (search.to) setTo(search.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ledgerId, search.from, search.to]);

  // Shared return-state mechanism: mirror the current selection into the
  // URL so back navigation from a drilled voucher restores exactly what
  // the user was viewing (ledger + date range + view mode).
  useReportUrlSync({
    to: "/app/reports/ledger",
    current: { ledgerId: search.ledgerId, from: search.from, to: search.to, view: search.view },
    next: { ledgerId, from, to, view },
    enabled: !!ledgerId,
  });

  const ledger = ledgers.find((l) => l.id === ledgerId);

  const [autoExpandedNote, setAutoExpandedNote] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId || !ledgerId || !ledger) return;
    let cancelled = false;
    void (async () => {
      setAutoExpandedNote(null);
      let effFrom = from;
      let effTo = to;
      const fetchEntries = async (f: string, t: string) => {
        return withCacheFallback<EntryRow[]>(
          async () => {
            const { data: ent, error } = await supabase
              .from("voucher_entries")
              .select("id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, reference_no, company_id)")
              .eq("ledger_id", ledgerId)
              .eq("vouchers.company_id", activeCompanyId)
              .gte("vouchers.voucher_date", f)
              .lte("vouchers.voucher_date", t)
              .order("voucher_date", { referencedTable: "vouchers", ascending: true })
              .order("voucher_number", { referencedTable: "vouchers", ascending: true });
            if (error) throw error;
            return (ent || []) as unknown as EntryRow[];
          },
          async () => {
            try {
              return (await readLedgerEntriesFast(activeCompanyId, ledgerId, { from: f, to: t })) as EntryRow[];
            } catch {
              return (await readVoucherEntriesWithVouchers(activeCompanyId, { ledgerId, from: f, to: t })) as EntryRow[];
            }
          },
        );
      };
      let list = await fetchEntries(effFrom, effTo);
      if (cancelled) return;
      // Auto-expand: if no entries in selected FY, probe all dates and switch if data exists outside the period.
      if (list.length === 0) {
        const allDates = await fetchEntries("1900-01-01", "2999-12-31");
        if (cancelled) return;
        if (allDates.length > 0) {
          effFrom = "1900-01-01";
          effTo = "2999-12-31";
          list = allDates;
          if (cancelled) return;
          setAutoExpandedNote(`No entries in ${from} – ${to}; auto-expanded to All Dates (${allDates.length} entry/entries found).`);
        }
      }
      setEntries(list);

      const prior = await withCacheFallback<{ debit_paise: number; credit_paise: number }[]>(
        async () => {
          const { data, error } = await supabase
            .from("voucher_entries")
            .select("debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
            .eq("ledger_id", ledgerId)
            .eq("vouchers.company_id", activeCompanyId)
            .lt("vouchers.voucher_date", effFrom);
          if (error) throw error;
          return (data || []) as { debit_paise: number; credit_paise: number }[];
        },
        async () => {
          try {
            return (await readLedgerEntriesFast(activeCompanyId, ledgerId, { before: effFrom })) as { debit_paise: number; credit_paise: number }[];
          } catch {
            return (await readVoucherEntriesWithVouchers(activeCompanyId, { ledgerId, before: effFrom })) as { debit_paise: number; credit_paise: number }[];
          }
        },
      );
      if (cancelled) return;
      const movement = prior.reduce(
        (s, e) => s + (e.debit_paise as number) - (e.credit_paise as number),
        0,
      );
      const obSigned = (ledger.opening_balance_is_debit ? 1 : -1) * ledger.opening_balance_paise;
      setOpeningBeforeFrom(obSigned + movement);

      // Sibling lookup for "particulars" in columnar view
      const ids = list.map((e) => e.vouchers?.id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setSiblings(new Map());
        setSiblingNames(new Map());
        return;
      }
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
      if (cancelled) return;
      const map = new Map<string, SiblingRow[]>();
      const ledgerIds = new Set<string>();
      for (const s of sibs) {
        const arr = map.get(s.voucher_id) ?? [];
        arr.push(s);
        map.set(s.voucher_id, arr);
        ledgerIds.add(s.ledger_id);
      }
      setSiblings(map);
      const names = await withCacheFallback<{ id: string; name: string; type: string }[]>(
        async () => {
          if (ledgerIds.size === 0) return [];
          const { data, error } = await supabase
            .from("ledgers")
            .select("id, name, type")
            .in("id", Array.from(ledgerIds));
          if (error) throw error;
          return (data || []) as { id: string; name: string; type: string }[];
        },
        async () => (await readLedgers(activeCompanyId))
          .filter((l: any) => ledgerIds.has(String(l.id)))
          .map((l: any) => ({ id: String(l.id), name: String(l.name ?? ""), type: String(l.type ?? "") })),
      );
      if (cancelled) return;
      const nameMap = new Map<string, { name: string; type: string }>();
      for (const n of names) {
        nameMap.set(n.id, { name: n.name, type: n.type });
      }
      setSiblingNames(nameMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, ledgerId, from, to, ledger]);


  // Single-pass totals + columnar rows w/ running balance (integer paise math)
  const { columnarRows, totals } = useMemo(() => {
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
    const rows: R[] = [];
    const sortedEntries = sortEntriesByVoucherAsc(entries);
    let bal = openingBeforeFrom;
    let dr = 0;
    let cr = 0;
    // Tally-style "Particulars": pick the contra-party only.
    // Prefer siblings on the opposite side of this entry, and skip tax ledgers
    // (Input/Output CGST/SGST/IGST) so a purchase shows just the supplier.
    const pickContra = (
      sibs: SiblingRow[],
      entryDebit: number,
      entryCredit: number,
    ): string => {
      const opposite = sibs.filter((s) =>
        entryDebit > 0 ? s.credit_paise > 0 : s.debit_paise > 0,
      );
      const pool = opposite.length > 0 ? opposite : sibs;
      const enriched = pool
        .map((s) => siblingNames.get(s.ledger_id))
        .filter((x): x is { name: string; type: string } => !!x);
      const nonTax = enriched.filter((x) => x.type !== "duties_taxes");
      const chosen = nonTax.length > 0 ? nonTax : enriched;
      return chosen.length ? chosen.map((x) => x.name).join(", ") : "—";
    };
    for (const e of sortedEntries) {
      const v = e.vouchers;
      if (!v) continue;
      const sibs = siblings.get(v.id) ?? [];
      const particulars = pickContra(sibs, e.debit_paise, e.credit_paise);
      bal = bal + e.debit_paise - e.credit_paise;
      dr += e.debit_paise;
      cr += e.credit_paise;
      rows.push({
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
    return { columnarRows: rows, totals: { dr, cr } };
  }, [entries, siblings, siblingNames, openingBeforeFrom]);

  const closing = openingBeforeFrom + totals.dr - totals.cr;
  const fmtBal = (paise: number) =>
    `${formatINR(Math.abs(paise), { symbol: false })} ${paise >= 0 ? "Dr" : "Cr"}`;

  // ---------- T-format (Horizontal) data — columnar shape ----------
  // Same columns as Grid view (Date | Particulars | Vch Type | Vch No | Chq/Ref | Amount),
  // split into Dr (left) and Cr (right) halves.
  const drRows: TColRow[] = [];
  const crRows: TColRow[] = [];
  if (openingBeforeFrom > 0) {
    drRows.push({
      date: fmtIndianDate(from),
      particulars: "To Opening Balance",
      amount: formatINR(openingBeforeFrom),
      emphasis: "bold",
    });
  } else if (openingBeforeFrom < 0) {
    crRows.push({
      date: fmtIndianDate(from),
      particulars: "By Opening Balance",
      amount: formatINR(-openingBeforeFrom),
      emphasis: "bold",
    });
  }
  const originFor = (v: EntryRow["vouchers"], entryDebit: number, entryCredit: number): string => {
    if (!v) return "—";
    const sibs = siblings.get(v.id) ?? [];
    const opposite = sibs.filter((s) =>
      entryDebit > 0 ? s.credit_paise > 0 : s.debit_paise > 0,
    );
    const pool = opposite.length > 0 ? opposite : sibs;
    const enriched = pool
      .map((s) => siblingNames.get(s.ledger_id))
      .filter((x): x is { name: string; type: string } => !!x);
    const nonTax = enriched.filter((x) => x.type !== "duties_taxes");
    const chosen = nonTax.length > 0 ? nonTax : enriched;
    if (chosen.length > 0) return chosen.map((x) => x.name).join(", ");
    return (TYPE_LABEL[v.voucher_type] ?? v.voucher_type).replace(/_/g, " ");
  };
  for (const e of sortEntriesByVoucherAsc(entries)) {
    const v = e.vouchers;
    if (!v) continue;
    const origin = originFor(v, e.debit_paise, e.credit_paise);
    const vchType = TYPE_LABEL[v.voucher_type] ?? v.voucher_type;
    const chqRef = (v.reference_no || "").trim();
    const goto = () => openVoucherDetail(navigate, v.id);
    if (e.debit_paise > 0) {
      drRows.push({
        date: fmtIndianDate(v.voucher_date),
        particulars: `To ${origin} A/c`,
        vchType,
        vchNo: v.voucher_number,
        chqRef,
        amount: formatINR(e.debit_paise),
        onClick: goto,
      });
    }
    if (e.credit_paise > 0) {
      crRows.push({
        date: fmtIndianDate(v.voucher_date),
        particulars: `By ${origin} A/c`,
        vchType,
        vchNo: v.voucher_number,
        chqRef,
        amount: formatINR(e.credit_paise),
        onClick: goto,
      });
    }
  }
  const drSubtotal = (openingBeforeFrom > 0 ? openingBeforeFrom : 0) + totals.dr;
  const crSubtotal = (openingBeforeFrom < 0 ? -openingBeforeFrom : 0) + totals.cr;
  if (drSubtotal > crSubtotal) {
    crRows.push({
      date: fmtIndianDate(to),
      particulars: "By Balance c/d",
      amount: formatINR(drSubtotal - crSubtotal),
      emphasis: "bold",
    });
  } else if (crSubtotal > drSubtotal) {
    drRows.push({
      date: fmtIndianDate(to),
      particulars: "To Balance c/d",
      amount: formatINR(crSubtotal - drSubtotal),
      emphasis: "bold",
    });
  }
  const grandTotal = Math.max(drSubtotal, crSubtotal);

  // ---------- Exports ----------
  const fileBase = `ledger-${ledger?.name ?? "x"}-${from}_to_${to}`;

  const csvRowsColumnar = (): (string | number)[][] => [
    [`Ledger: ${ledger?.name ?? ""}`, "", "", "", "", "", "", ""],
    [`Period: ${fmtIndianDate(from)} to ${fmtIndianDate(to)}`, "", "", "", "", "", "", ""],
    ["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"],
    ["Opening Balance", "", "", "", "", "", "", fmtBal(openingBeforeFrom)],
    ...columnarRows.map((row) => [
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

  // 12-column shape mirroring the on-screen T: Dr (Date, Particulars, Vch Type, Vch No, Chq/Ref, Amount) | Cr (same)
  const horizontalBody = (): (string | number)[][] =>
    Array.from({ length: Math.max(drRows.length, crRows.length) }).map((_, i) => {
      const l = drRows[i];
      const r2 = crRows[i];
      const cell = (v: unknown) => (v == null ? "" : String(v));
      const amt = (v: unknown) => {
        if (v == null) return "";
        const s = String(v).replace(/[^\d.\-]/g, "");
        return s ? Number(s).toFixed(2) : String(v);
      };
      return [
        l ? cell(l.date) : "",
        l ? cell(l.particulars) : "",
        l ? cell(l.vchType) : "",
        l ? cell(l.vchNo) : "",
        l ? cell(l.chqRef) : "",
        l ? amt(l.amount) : "",
        r2 ? cell(r2.date) : "",
        r2 ? cell(r2.particulars) : "",
        r2 ? cell(r2.vchType) : "",
        r2 ? cell(r2.vchNo) : "",
        r2 ? cell(r2.chqRef) : "",
        r2 ? amt(r2.amount) : "",
      ];
    });

  const horizontalHead = ["Date", "Particulars", "Vch Type", "Vch No", "Chq/Ref", amountHeader()];

  const csvRowsHorizontal = (): (string | number)[][] => [
    [`Ledger: ${ledger?.name ?? ""}`, ...Array(11).fill("")],
    [`Period: ${fmtIndianDate(from)} to ${fmtIndianDate(to)}`, ...Array(11).fill("")],
    ["Dr.", "", "", "", "", "", "Cr.", "", "", "", "", ""],
    [...horizontalHead, ...horizontalHead],
    ...horizontalBody(),
    ["Total", "", "", "", "", r(grandTotal).toFixed(2), "Total", "", "", "", "", r(grandTotal).toFixed(2)],
    ["", "", "", "", "", "", "Closing Balance", "", "", "", "", fmtBal(closing)],
  ];

  const onExportCsv = () =>
    downloadCsv(`${fileBase}-${view}.csv`, view === "columnar" ? csvRowsColumnar() : csvRowsHorizontal());
  const onExportXlsx = () =>
    downloadXlsx(`${fileBase}-${view}.xlsx`, [
      { name: "Ledger", rows: view === "columnar" ? csvRowsColumnar() : csvRowsHorizontal() },
    ]);
  const onExportPdf = () => {
    if (view === "columnar") {
      const showNarr = columnarRows.some((row) => (row.narration || "").trim().length > 0);
      const head = showNarr
        ? ["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"]
        : ["Date", "Particulars", "Vch Type", "Vch No", "Debit", "Credit", "Balance"];
      const openingRow = showNarr
        ? ["", "Opening Balance", "", "", "", "", "", fmtBal(openingBeforeFrom)]
        : ["", "Opening Balance", "", "", "", "", fmtBal(openingBeforeFrom)];
      const bodyRows = columnarRows.map((row) => {
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
      const footRows = showNarr
        ? [
            ["Total", "", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
            ["Closing Balance", "", "", "", "", "", "", fmtBal(closing)],
          ]
        : [
            ["Total", "", "", "", r(totals.dr).toFixed(2), r(totals.cr).toFixed(2), ""],
            ["Closing Balance", "", "", "", "", "", fmtBal(closing)],
          ];
      downloadPdfTable({
        title: `Ledger A/c — ${ledger?.name ?? ""}`,
        subtitle: pdfHeader.dateRangeSubtitle(from, to),
        companyName: pdfHeader.companyName,
        companySubLine: pdfHeader.companySubLine,
        head: [head],
        body: [openingRow, ...bodyRows],
        foot: footRows,
        fileName: `${fileBase}-columnar.pdf`,
        orientation: "l",
        rightAlignCols: showNarr ? [5, 6, 7] : [4, 5, 6],
      });
    } else {
      downloadPdfTable({
        title: `Ledger A/c — ${ledger?.name ?? ""}`,
        subtitle: pdfHeader.dateRangeSubtitle(from, to),
        companyName: pdfHeader.companyName,
        companySubLine: pdfHeader.companySubLine,
        head: [
          [
            { content: "Dr.", colSpan: 6, styles: { halign: "center", fontStyle: "bold" } } as never,
            { content: "Cr.", colSpan: 6, styles: { halign: "center", fontStyle: "bold" } } as never,
          ],
          [...horizontalHead, ...horizontalHead],
        ],
        body: horizontalBody(),
        foot: [
          ["Total", "", "", "", "", r(grandTotal).toFixed(2), "Total", "", "", "", "", r(grandTotal).toFixed(2)],
          ["", "", "", "", "", "", "Closing Balance", "", "", "", "", fmtBal(closing)],
        ],
        fileName: `${fileBase}-horizontal.pdf`,
        orientation: "l",
        rightAlignCols: [5, 11],
        dividerBeforeCol: 6,
      });
    }
  };

  // ---------- All-Ledgers (batch) builder ----------
  type AllRow = { date: string; particulars: string; vchType: string; vchNo: string; narration: string; debit: number; credit: number; balance: number };
  type AllSection = { ledger: LedgerOpt; opening: number; rows: AllRow[]; dr: number; cr: number; closing: number };
  const [allMode, setAllMode] = useState(false);
  const [allSections, setAllSections] = useState<AllSection[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);

  const buildAllLedgersData = async (): Promise<AllSection[]> => {
    if (!activeCompanyId || ledgers.length === 0) return [];
    const allEntries = await withCacheFallback<(EntryRow & { ledger_id: string })[]>(
      async () => {
        const { data, error } = await supabase
          .from("voucher_entries")
          .select("id, ledger_id, debit_paise, credit_paise, narration, vouchers!inner(id, voucher_date, voucher_number, voucher_type, narration, reference_no, company_id)")
          .eq("vouchers.company_id", activeCompanyId)
          .gte("vouchers.voucher_date", from)
          .lte("vouchers.voucher_date", to);
        if (error) throw error;
        return ((data || []) as unknown) as (EntryRow & { ledger_id: string })[];
      },
      async () => (await readVoucherEntriesWithVouchers(activeCompanyId, { from, to })) as (EntryRow & { ledger_id: string })[],
    );

    const prior = await withCacheFallback<{ ledger_id: string; debit_paise: number; credit_paise: number }[]>(
      async () => {
        const { data, error } = await supabase
          .from("voucher_entries")
          .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
          .eq("vouchers.company_id", activeCompanyId)
          .lt("vouchers.voucher_date", from);
        if (error) throw error;
        return (data || []) as { ledger_id: string; debit_paise: number; credit_paise: number }[];
      },
      async () => (await readVoucherEntriesWithVouchers(activeCompanyId, { before: from })) as { ledger_id: string; debit_paise: number; credit_paise: number }[],
    );
    const movement = new Map<string, number>();
    for (const p of prior) {
      movement.set(p.ledger_id, (movement.get(p.ledger_id) ?? 0) + p.debit_paise - p.credit_paise);
    }

    const voucherIds = Array.from(new Set(allEntries.map((e) => e.vouchers?.id).filter(Boolean) as string[]));
    const sibsByVoucher = new Map<string, { ledger_id: string; debit_paise: number; credit_paise: number }[]>();
    const infoById = new Map<string, { name: string; type: string }>();
    if (voucherIds.length > 0) {
      const sibs = await withCacheFallback<{ voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number }[]>(
        async () => {
          const { data, error } = await supabase
            .from("voucher_entries").select("voucher_id, ledger_id, debit_paise, credit_paise").in("voucher_id", voucherIds);
          if (error) throw error;
          return (data || []) as { voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number }[];
        },
        async () => ((await readVoucherEntriesWithVouchers(activeCompanyId)) as any[])
          .filter((e) => voucherIds.includes(String(e.voucher_id)))
          .map((e) => ({
            voucher_id: String(e.voucher_id),
            ledger_id: String(e.ledger_id),
            debit_paise: Number(e.debit_paise ?? 0),
            credit_paise: Number(e.credit_paise ?? 0),
          })),
      );
      const ledgerIds = new Set<string>();
      for (const s of sibs) {
        const arr = sibsByVoucher.get(s.voucher_id) ?? [];
        arr.push({ ledger_id: s.ledger_id, debit_paise: s.debit_paise, credit_paise: s.credit_paise });
        sibsByVoucher.set(s.voucher_id, arr);
        ledgerIds.add(s.ledger_id);
      }
      const names = await withCacheFallback<{ id: string; name: string; type: string }[]>(
        async () => {
          if (ledgerIds.size === 0) return [];
          const { data, error } = await supabase
            .from("ledgers").select("id, name, type").in("id", Array.from(ledgerIds));
          if (error) throw error;
          return (data || []) as { id: string; name: string; type: string }[];
        },
        async () => (await readLedgers(activeCompanyId))
          .filter((l: any) => ledgerIds.has(String(l.id)))
          .map((l: any) => ({ id: String(l.id), name: String(l.name ?? ""), type: String(l.type ?? "") })),
      );
      for (const n of names) {
        infoById.set(n.id, { name: n.name, type: n.type });
      }
    }

    const byLedger = new Map<string, (EntryRow & { ledger_id: string })[]>();
    for (const e of allEntries) {
      const arr = byLedger.get(e.ledger_id) ?? [];
      arr.push(e);
      byLedger.set(e.ledger_id, arr);
    }

    const sections: AllSection[] = [];
    for (const l of ledgers) {
      const obSigned = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
      const opening = obSigned + (movement.get(l.id) ?? 0);
      const list = sortEntriesByVoucherAsc(byLedger.get(l.id) ?? []);
      if (list.length === 0 && opening === 0) continue;
      let bal = opening, dr = 0, cr = 0;
      const rows: AllRow[] = [];
      for (const e of list) {
        const v = e.vouchers; if (!v) continue;
        const sibs = sibsByVoucher.get(v.id) ?? [];
        const opposite = sibs.filter((s) =>
          e.debit_paise > 0 ? s.credit_paise > 0 : s.debit_paise > 0,
        );
        const pool = (opposite.length > 0 ? opposite : sibs).filter((s) => s.ledger_id !== l.id);
        const enriched = pool
          .map((s) => infoById.get(s.ledger_id))
          .filter((x): x is { name: string; type: string } => !!x);
        const nonTax = enriched.filter((x) => x.type !== "duties_taxes");
        const chosen = nonTax.length > 0 ? nonTax : enriched;
        bal += e.debit_paise - e.credit_paise;
        dr += e.debit_paise; cr += e.credit_paise;
        rows.push({
          date: v.voucher_date,
          particulars: chosen.length ? chosen.map((x) => x.name).join(", ") : "—",
          vchType: TYPE_LABEL[v.voucher_type] ?? v.voucher_type,
          vchNo: v.voucher_number,
          narration: narrationOf(e, v),
          debit: e.debit_paise, credit: e.credit_paise, balance: bal,
        });
      }
      sections.push({ ledger: l, opening, rows, dr, cr, closing: opening + dr - cr });
    }
    return sections;
  };

  const ensureAllSections = async (): Promise<AllSection[]> => {
    if (allSections) return allSections;
    setAllLoading(true);
    try {
      const s = await buildAllLedgersData();
      setAllSections(s);
      return s;
    } finally {
      setAllLoading(false);
    }
  };

  useEffect(() => { setAllSections(null); }, [from, to, activeCompanyId]);

  const onViewAll = async () => { await ensureAllSections(); setAllMode(true); };

  // Build Dr/Cr T-format rows for a single AllSection (mirrors the on-screen T-format).
  const buildTSides = (s: AllSection) => {
    type Side = { date: string; particulars: string; vchType: string; vchNo: string; chqRef: string; amount: number };
    const dr: Side[] = [];
    const cr: Side[] = [];
    if (s.opening > 0) {
      dr.push({ date: fmtIndianDate(from), particulars: "To Opening Balance", vchType: "", vchNo: "", chqRef: "", amount: s.opening });
    } else if (s.opening < 0) {
      cr.push({ date: fmtIndianDate(from), particulars: "By Opening Balance", vchType: "", vchNo: "", chqRef: "", amount: -s.opening });
    }
    for (const row of s.rows) {
      if (row.debit > 0) {
        dr.push({ date: fmtIndianDate(row.date), particulars: `To ${row.particulars} A/c`, vchType: row.vchType, vchNo: row.vchNo, chqRef: "", amount: row.debit });
      }
      if (row.credit > 0) {
        cr.push({ date: fmtIndianDate(row.date), particulars: `By ${row.particulars} A/c`, vchType: row.vchType, vchNo: row.vchNo, chqRef: "", amount: row.credit });
      }
    }
    const drSub = (s.opening > 0 ? s.opening : 0) + s.dr;
    const crSub = (s.opening < 0 ? -s.opening : 0) + s.cr;
    if (drSub > crSub) {
      cr.push({ date: fmtIndianDate(to), particulars: "By Balance c/d", vchType: "", vchNo: "", chqRef: "", amount: drSub - crSub });
    } else if (crSub > drSub) {
      dr.push({ date: fmtIndianDate(to), particulars: "To Balance c/d", vchType: "", vchNo: "", chqRef: "", amount: crSub - drSub });
    }
    return { dr, cr, total: Math.max(drSub, crSub) };
  };

  const onExportAllPdf = async () => {
    const data = await ensureAllSections();
    if (data.length === 0) { toast.info("No ledgers with activity in this period."); return; }
    const sections: PdfSection[] = view === "horizontal"
      ? data.map((s) => {
          const { dr, cr, total } = buildTSides(s);
          const body = Array.from({ length: Math.max(dr.length, cr.length) }).map((_, i) => {
            const l = dr[i]; const r2 = cr[i];
            return [
              l ? l.date : "", l ? l.particulars : "", l ? l.vchType : "", l ? l.vchNo : "", l ? l.chqRef : "", l ? r(l.amount).toFixed(2) : "",
              r2 ? r2.date : "", r2 ? r2.particulars : "", r2 ? r2.vchType : "", r2 ? r2.vchNo : "", r2 ? r2.chqRef : "", r2 ? r(r2.amount).toFixed(2) : "",
            ];
          });
          return {
            sectionTitle: `Ledger A/c — ${s.ledger.name}`,
            head: [
              [
                { content: "Dr.", colSpan: 6, styles: { halign: "center", fontStyle: "bold" } },
                { content: "Cr.", colSpan: 6, styles: { halign: "center", fontStyle: "bold" } },
              ],
              [...horizontalHead, ...horizontalHead],
            ],
            body,
            foot: [
              ["Total", "", "", "", "", r(total).toFixed(2), "Total", "", "", "", "", r(total).toFixed(2)],
            ],
            rightAlignCols: [5, 11],
            dividerBeforeCol: 6,
          } as PdfSection;
        })
      : data.map((s) => {
      const showNarr = s.rows.some((row) => (row.narration || "").trim().length > 0);
      const head = showNarr
        ? ["Date", "Particulars", "Vch Type", "Vch No", "Narration", "Debit", "Credit", "Balance"]
        : ["Date", "Particulars", "Vch Type", "Vch No", "Debit", "Credit", "Balance"];
      const openingRow = showNarr
        ? ["", "Opening Balance", "", "", "", "", "", fmtBal(s.opening)]
        : ["", "Opening Balance", "", "", "", "", fmtBal(s.opening)];
      const bodyRows = s.rows.map((row) => {
        const base = [fmtIndianDate(row.date), row.particulars, row.vchType, row.vchNo];
        const tail = [
          row.debit ? r(row.debit).toFixed(2) : "",
          row.credit ? r(row.credit).toFixed(2) : "",
          fmtBal(row.balance),
        ];
        return showNarr ? [...base, row.narration, ...tail] : [...base, ...tail];
      });
      const foot = showNarr
        ? [
            ["Total", "", "", "", "", r(s.dr).toFixed(2), r(s.cr).toFixed(2), ""],
            ["Closing Balance", "", "", "", "", "", "", fmtBal(s.closing)],
          ]
        : [
            ["Total", "", "", "", r(s.dr).toFixed(2), r(s.cr).toFixed(2), ""],
            ["Closing Balance", "", "", "", "", "", fmtBal(s.closing)],
          ];
      return {
        sectionTitle: `Ledger A/c — ${s.ledger.name}`,
        head: [head], body: [openingRow, ...bodyRows], foot,
        rightAlignCols: showNarr ? [5, 6, 7] : [4, 5, 6],
      };
    });
    downloadPdfMultiTable({
      title: "All Ledgers",
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      fileName: `all-ledgers-${view}-${from}_to_${to}.pdf`,
      orientation: "l",
      sections,
    });
  };

  const onExportAllWord = async () => {
    const data = await ensureAllSections();
    if (data.length === 0) { toast.info("No ledgers with activity in this period."); return; }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmtMoney = (p: number) => p ? r(p).toFixed(2) : "";
    const periodLine = `${fmtIndianDate(from)} to ${fmtIndianDate(to)}`;
    const headerHtml = `
      <div class="report-print-header">
        ${pdfHeader.companyName ? `<div style="font-weight:bold;font-size:13pt">${esc(pdfHeader.companyName.toUpperCase())}</div>` : ""}
        ${pdfHeader.companySubLine ? `<div style="font-size:9pt">${esc(pdfHeader.companySubLine)}</div>` : ""}
        <div style="font-weight:bold;font-size:12pt;margin-top:4pt">All Ledgers</div>
        <div style="font-size:10pt">${esc(periodLine)}</div>
      </div>`;
    const sectionsHtml = data.map((s, idx) => {
      if (view === "horizontal") {
        const { dr, cr, total } = buildTSides(s);
        const len = Math.max(dr.length, cr.length);
        const headCols = `<th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No</th><th>Chq/Ref</th><th class="num">Amount</th>`;
        const head = `<thead>
            <tr><th colspan="6" style="text-align:center">Dr.</th><th colspan="6" style="text-align:center">Cr.</th></tr>
            <tr>${headCols}${headCols}</tr>
          </thead>`;
        const body = Array.from({ length: len }).map((_, i) => {
          const l = dr[i]; const r2 = cr[i];
          const sideCells = (x?: { date: string; particulars: string; vchType: string; vchNo: string; chqRef: string; amount: number }) =>
            x ? `<td>${esc(x.date)}</td><td>${esc(x.particulars)}</td><td>${esc(x.vchType)}</td><td>${esc(x.vchNo)}</td><td>${esc(x.chqRef)}</td><td class="num">${fmtMoney(x.amount)}</td>`
              : `<td></td><td></td><td></td><td></td><td></td><td class="num"></td>`;
          return `<tr>${sideCells(l)}${sideCells(r2)}</tr>`;
        }).join("");
        const foot = `<tr class="row-bold">
            <td colspan="5">Total</td><td class="num">${r(total).toFixed(2)}</td>
            <td colspan="5">Total</td><td class="num">${r(total).toFixed(2)}</td>
          </tr>`;
        return `<div class="${idx > 0 ? "page-break" : ""}">
            <h2 class="ledger-heading">Ledger A/c — ${esc(s.ledger.name)}</h2>
            <table>${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>
          </div>`;
      }
      const showNarr = s.rows.some((row) => (row.narration || "").trim().length > 0);
      const head = `<thead><tr>
          <th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No</th>
          ${showNarr ? "<th>Narration</th>" : ""}
          <th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th>
        </tr></thead>`;
      const opening = `<tr class="row-bold"><td colspan="${showNarr ? 7 : 6}">Opening Balance</td><td class="num">${esc(fmtBal(s.opening))}</td></tr>`;
      const body = s.rows.map((row) => `<tr>
          <td>${esc(fmtIndianDate(row.date))}</td>
          <td>${esc(row.particulars)}</td>
          <td>${esc(row.vchType)}</td>
          <td>${esc(row.vchNo)}</td>
          ${showNarr ? `<td>${esc(row.narration)}</td>` : ""}
          <td class="num">${fmtMoney(row.debit)}</td>
          <td class="num">${fmtMoney(row.credit)}</td>
          <td class="num">${esc(fmtBal(row.balance))}</td>
        </tr>`).join("");
      const foot = `
        <tr class="row-bold"><td colspan="${showNarr ? 5 : 4}">Total</td>
          <td class="num">${r(s.dr).toFixed(2)}</td>
          <td class="num">${r(s.cr).toFixed(2)}</td><td></td></tr>
        <tr class="row-bold"><td colspan="${showNarr ? 7 : 6}">Closing Balance</td>
          <td class="num">${esc(fmtBal(s.closing))}</td></tr>`;
      return `<div class="${idx > 0 ? "page-break" : ""}">
          <h2 class="ledger-heading">Ledger A/c — ${esc(s.ledger.name)}</h2>
          <table>${head}<tbody>${opening}${body}</tbody><tfoot>${foot}</tfoot></table>
        </div>`;
    }).join("");
    exportHtmlAsWord({
      bodyHtml: sectionsHtml,
      title: "All Ledgers",
      fileName: `all-ledgers-${view === "horizontal" ? "t-format" : "columnar"}-${from}_to_${to}.doc`,
      headerHtml,
      orientation: "landscape",
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
              {showBack && (
                <div className="space-y-1">
                  <Label className="text-xs">&nbsp;</Label>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-9 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md ring-2 ring-primary/30 font-semibold"
                    onClick={() => goBackFromLedger(() => navigate({ to: "/app/reports" }))}
                    title="Back to originating report (Esc)"
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Report
                  </Button>
                </div>
              )}
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
              <div className="space-y-1">
                <Label className="text-xs">Format</Label>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={view}
                  onValueChange={(v) => v && setView(v as ViewMode)}
                  className="h-9 rounded-md border border-input bg-background p-0.5"
                >
                  <ToggleGroupItem value="columnar" className="px-3 text-xs">
                    Columnar Format
                  </ToggleGroupItem>
                  <ToggleGroupItem value="horizontal" className="px-3 text-xs">
                    Horizontal / T-Format
                  </ToggleGroupItem>
                  <ToggleGroupItem value="grid" className="px-3 text-xs">
                    Grid (Excel-like)
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">All Ledgers (one go)</Label>
                <div className="flex h-9 items-center gap-1">
                  <Button variant={allMode ? "default" : "outline"} size="sm" onClick={onViewAll} disabled={allLoading}>
                    <Eye className="mr-1 h-4 w-4" /> {allLoading ? "Loading…" : "View All"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={onExportAllPdf} disabled={allLoading}>
                    <FileText className="mr-1 h-4 w-4" /> All PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={onExportAllWord} disabled={allLoading}>
                    <FileType2 className="mr-1 h-4 w-4" /> All Word
                  </Button>
                  {allMode && (
                    <Button variant="ghost" size="sm" onClick={() => setAllMode(false)}>Single</Button>
                  )}
                </div>
              </div>
            </div>
          }
        />
      </CardContent>
    </Card>
  );

  type LedgerRowVm = (typeof columnarRows)[number];
  const ledgerGridColumns: DGColumn<LedgerRowVm>[] = useMemo(() => [
    { id: "date", header: "Date", type: "date", width: 110, accessor: (x) => x.date, cell: (x) => fmtIndianDate(x.date) },
    { id: "particulars", header: "Particulars", type: "text", width: 240, accessor: (x) => x.particulars, groupable: true },
    { id: "vchType", header: "Vch Type", type: "enum", width: 110, accessor: (x) => x.vchType, groupable: true },
    { id: "vchNo", header: "Vch No", type: "text", width: 110, accessor: (x) => x.vchNo },
    { id: "narration", header: "Narration", type: "text", width: 260, accessor: (x) => x.narration },
    { id: "debit", header: "Debit", type: "number", width: 130, align: "right", accessor: (x) => x.debit / 100, cell: (x) => x.debit ? formatINR(x.debit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
    { id: "credit", header: "Credit", type: "number", width: 130, align: "right", accessor: (x) => x.credit / 100, cell: (x) => x.credit ? formatINR(x.credit, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
    { id: "balance", header: "Balance", type: "number", width: 140, align: "right", accessor: (x) => x.balance / 100, cell: (x) => fmtBal(x.balance) },
  ], []);

  return (
    <ReportViewer
      title="Ledger Statement"
      subtitle={undefined}
      accountHeading={ledger ? `Ledger Account: ${ledger.name}` : "Ledger Statement"}
      companyCity={undefined}
      companyGstin={undefined}
      fromDate={from}
      toDate={to}
      toolbar={toolbar}
      orientation="landscape"
      onExportPdf={onExportPdf}
      exportFileBase={`${fileBase}-${view}`}
    >
      {autoExpandedNote && !allMode && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {autoExpandedNote}
        </div>
      )}
      {allMode ? (

        <div className="space-y-6">
          {(allSections ?? []).length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">{allLoading ? "Loading all ledgers…" : "No ledgers with activity in this period."}</CardContent></Card>
          ) : (
            (allSections ?? []).map((s) => {
              if (view === "horizontal") {
                const { dr, cr, total } = buildTSides(s);
                const leftRows: TColRow[] = dr.map((x) => ({
                  date: x.date,
                  particulars: x.particulars,
                  vchType: x.vchType,
                  vchNo: x.vchNo,
                  chqRef: x.chqRef,
                  amount: formatINR(x.amount, { symbol: false }),
                  emphasis: x.particulars.includes("Balance") ? "bold" : "normal",
                }));
                const rightRows: TColRow[] = cr.map((x) => ({
                  date: x.date,
                  particulars: x.particulars,
                  vchType: x.vchType,
                  vchNo: x.vchNo,
                  chqRef: x.chqRef,
                  amount: formatINR(x.amount, { symbol: false }),
                  emphasis: x.particulars.includes("Balance") ? "bold" : "normal",
                }));
                return (
                  <TAccountColumnar
                    key={s.ledger.id}
                    title={`${s.ledger.name} Account`}
                    subtitle={`for the period ${fmtIndianDate(from)} to ${fmtIndianDate(to)}`}
                    leftRows={leftRows}
                    rightRows={rightRows}
                    leftTotal={formatINR(total, { symbol: false })}
                    rightTotal={formatINR(total, { symbol: false })}
                    closingLine={`Closing balance: ${fmtBal(s.closing)}`}
                  />
                );
              }
              return (
              <Card key={s.ledger.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="bg-muted/40 px-3 py-2 text-sm font-semibold">Ledger A/c — {s.ledger.name}</div>
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
                        <td className="border-b border-border p-2 font-semibold" colSpan={7}>Opening Balance</td>
                        <td className="border-b border-border p-2 num font-semibold">{fmtBal(s.opening)}</td>
                      </tr>
                      {s.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="border-b border-border/60 p-2 whitespace-nowrap">{fmtIndianDate(row.date)}</td>
                          <td className="border-b border-border/60 p-2">{row.particulars}</td>
                          <td className="border-b border-border/60 p-2 whitespace-nowrap">{row.vchType}</td>
                          <td className="border-b border-border/60 p-2 whitespace-nowrap">{row.vchNo}</td>
                          <td className="border-b border-border/60 p-2 narration-cell text-muted-foreground">{row.narration}</td>
                          <td className="border-b border-border/60 p-2 num">{row.debit ? formatINR(row.debit, { symbol: false }) : ""}</td>
                          <td className="border-b border-border/60 p-2 num">{row.credit ? formatINR(row.credit, { symbol: false }) : ""}</td>
                          <td className="border-b border-border/60 p-2 num">{fmtBal(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="row-bold bg-muted/50">
                        <td className="p-2 font-semibold" colSpan={5}>Total</td>
                        <td className="p-2 num font-semibold">{formatINR(s.dr, { symbol: false })}</td>
                        <td className="p-2 num font-semibold">{formatINR(s.cr, { symbol: false })}</td>
                        <td className="p-2"></td>
                      </tr>
                      <tr className="row-bold bg-muted/30">
                        <td className="p-2 font-semibold" colSpan={7}>Closing Balance</td>
                        <td className="p-2 num font-semibold">{fmtBal(s.closing)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </CardContent>
              </Card>
              );
            })
          )}
        </div>
      ) : !ledger ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a ledger to view its statement.</CardContent></Card>
      ) : view === "columnar" ? (
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
                  <td className="border-b border-border p-2 font-semibold" colSpan={7}>Opening Balance</td>
                  <td className="border-b border-border p-2 num font-semibold">{fmtBal(openingBeforeFrom)}</td>
                </tr>
                {columnarRows.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-muted-foreground" colSpan={8}>No entries in this period.</td>
                  </tr>
                ) : (
                  columnarRows.map((row) => (
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
      ) : view === "horizontal" ? (
        <>
          <TAccountColumnar
            title={`${ledger.name} Account`}
            subtitle={`for the period ${fmtIndianDate(from)} to ${fmtIndianDate(to)}`}
            leftRows={drRows}
            rightRows={crRows}
            leftTotal={formatINR(grandTotal)}
            rightTotal={formatINR(grandTotal)}
          />
          <Card>
            <CardContent className="flex justify-between p-3 text-sm">
              <span className="text-muted-foreground">Closing balance</span>
              <span className="font-mono font-semibold">{fmtBal(closing)}</span>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId="ledger"
              rows={columnarRows}
              columns={ledgerGridColumns}
              globalSearch={(x) => `${x.vchNo} ${x.particulars} ${x.narration}`}
              onRowClick={(x) => openVoucherDetail(navigate, x.voucherId)}
              height={520}
            />
            <div className="mt-2 flex justify-between border-t pt-2 text-sm">
              <span className="text-muted-foreground">Opening: <span className="font-mono">{fmtBal(openingBeforeFrom)}</span></span>
              <span className="font-semibold">Closing: <span className="font-mono">{fmtBal(closing)}</span></span>
            </div>
          </CardContent>
        </Card>
      )}
    </ReportViewer>
  );
}
