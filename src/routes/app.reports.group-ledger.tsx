import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { openLedgerReport } from "@/lib/voucher-return";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { downloadXlsx, downloadPdfTable, r } from "@/lib/exporters";
import type { LedgerTypeValue } from "@/lib/constants";

export const Route = createFileRoute("/app/reports/group-ledger")({
  head: () => ({ meta: [{ title: "Group Ledger Report — Reports" }] }),
  component: GroupLedgerReport,
});

type GroupKey =
  | "sundry_debtors"
  | "sundry_creditors"
  | "cash_in_hand"
  | "bank_accounts"
  | "loans_liabilities"
  | "current_liabilities"
  | "duties_taxes"
  | "capital"
  | "fixed_assets"
  | "investments"
  | "current_assets"
  | "stock_in_hand"
  | "direct_income"
  | "indirect_income"
  | "direct_expenses"
  | "indirect_expenses"
  | "all_assets"
  | "all_liabilities"
  | "all_income"
  | "all_expenses";

interface GroupDef {
  key: GroupKey;
  label: string;
  section: "Balance Sheet" | "Profit & Loss" | "Combined";
  types: LedgerTypeValue[];
  nature: "debit" | "credit";
  /** If set, filter ledgers to those whose group_code matches one of these codes. */
  groupCodes?: string[];
  /** If set, exclude ledgers whose group_code matches one of these codes. */
  excludeGroupCodes?: string[];
}

const GROUPS: GroupDef[] = [
  { key: "sundry_debtors", label: "Sundry Debtors", section: "Balance Sheet", types: ["sundry_debtor"], nature: "debit" },
  { key: "cash_in_hand", label: "Cash-in-Hand", section: "Balance Sheet", types: ["cash"], nature: "debit" },
  { key: "bank_accounts", label: "Bank Accounts", section: "Balance Sheet", types: ["bank"], nature: "debit" },
  { key: "fixed_assets", label: "Fixed Assets", section: "Balance Sheet", types: ["fixed_asset"], nature: "debit" },
  { key: "investments", label: "Investments", section: "Balance Sheet", types: ["current_asset", "fixed_asset"], nature: "debit", groupCodes: ["INVESTMENTS"] },
  { key: "current_assets", label: "Current Assets", section: "Balance Sheet", types: ["current_asset"], nature: "debit", excludeGroupCodes: ["INVESTMENTS"] },
  { key: "stock_in_hand", label: "Stock-in-Hand", section: "Balance Sheet", types: ["stock_in_hand"], nature: "debit" },
  { key: "all_assets", label: "All Assets (combined)", section: "Balance Sheet", types: ["sundry_debtor", "cash", "bank", "fixed_asset", "current_asset", "stock_in_hand"], nature: "debit" },
  { key: "sundry_creditors", label: "Sundry Creditors", section: "Balance Sheet", types: ["sundry_creditor"], nature: "credit" },
  { key: "loans_liabilities", label: "Loans (Liability)", section: "Balance Sheet", types: ["loan_liability"], nature: "credit" },
  { key: "current_liabilities", label: "Current Liabilities", section: "Balance Sheet", types: ["current_liability"], nature: "credit" },
  { key: "duties_taxes", label: "Duties & Taxes", section: "Balance Sheet", types: ["duties_taxes"], nature: "credit" },
  { key: "capital", label: "Capital Account", section: "Balance Sheet", types: ["capital"], nature: "credit" },
  { key: "all_liabilities", label: "All Liabilities (combined)", section: "Balance Sheet", types: ["sundry_creditor", "loan_liability", "current_liability", "duties_taxes", "capital"], nature: "credit" },
  { key: "direct_income", label: "Direct Income (Sales)", section: "Profit & Loss", types: ["income_direct"], nature: "credit" },
  { key: "indirect_income", label: "Indirect Income", section: "Profit & Loss", types: ["income_indirect"], nature: "credit" },
  { key: "all_income", label: "All Income (combined)", section: "Profit & Loss", types: ["income_direct", "income_indirect"], nature: "credit" },
  { key: "direct_expenses", label: "Direct Expenses", section: "Profit & Loss", types: ["expense_direct"], nature: "debit" },
  { key: "indirect_expenses", label: "Indirect Expenses", section: "Profit & Loss", types: ["expense_indirect"], nature: "debit" },
  { key: "all_expenses", label: "All Expenses (combined)", section: "Profit & Loss", types: ["expense_direct", "expense_indirect"], nature: "debit" },
];

interface LedgerRow {
  id: string;
  name: string;
  type: LedgerTypeValue;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
  group_code: string | null;
}
interface EntryRow {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string } | null;
}

function GroupLedgerReport() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const navigate = useNavigate();
  const [groupKey, setGroupKey] = useState<GroupKey>("sundry_debtors");
  const { from, to, setFrom, setTo } = useFyRangeState();
  const { view, setView } = useReportView("group-ledger");
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const group = useMemo(() => GROUPS.find((g) => g.key === groupKey)!, [groupKey]);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    Promise.all([
      supabase.from("ledgers")
        .select("id, name, type, group_code, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", activeCompanyId)
        .eq("is_active", true)
        .in("type", group.types)
        .order("name"),
      supabase.from("voucher_entries")
        .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
        .eq("vouchers.company_id", activeCompanyId)
        .lte("vouchers.voucher_date", to),
    ]).then(([l, e]) => {
      let rows = (l.data || []) as LedgerRow[];
      if (group.groupCodes) {
        const set = new Set(group.groupCodes);
        rows = rows.filter((r) => r.group_code && set.has(r.group_code));
      }
      if (group.excludeGroupCodes) {
        const ex = new Set(group.excludeGroupCodes);
        rows = rows.filter((r) => !r.group_code || !ex.has(r.group_code));
      }
      setLedgers(rows);
      setEntries((e.data || []) as unknown as EntryRow[]);
      setLoading(false);
    });
  }, [activeCompanyId, group, to]);

  const rows = useMemo(() => {
    const ledgerIds = new Set(ledgers.map((l) => l.id));
    const before = new Map<string, { dr: number; cr: number }>();
    const period = new Map<string, { dr: number; cr: number }>();
    for (const e of entries) {
      if (!ledgerIds.has(e.ledger_id) || !e.vouchers) continue;
      const d = e.vouchers.voucher_date;
      const bucket = d < from ? before : d <= to ? period : null;
      if (!bucket) continue;
      const cur = bucket.get(e.ledger_id) || { dr: 0, cr: 0 };
      cur.dr += e.debit_paise;
      cur.cr += e.credit_paise;
      bucket.set(e.ledger_id, cur);
    }
    return ledgers.map((l) => {
      const opSign = l.opening_balance_is_debit ? 1 : -1;
      const op = opSign * l.opening_balance_paise;
      const b = before.get(l.id) || { dr: 0, cr: 0 };
      const p = period.get(l.id) || { dr: 0, cr: 0 };
      const opening = op + (b.dr - b.cr);
      const closing = opening + (p.dr - p.cr);
      const display = group.nature === "debit" ? closing : -closing;
      return {
        id: l.id,
        name: l.name,
        type: l.type,
        opening_paise: group.nature === "debit" ? opening : -opening,
        debit_paise: p.dr,
        credit_paise: p.cr,
        closing_paise: display,
      };
    }).sort((a, b) => Math.abs(b.closing_paise) - Math.abs(a.closing_paise));
  }, [ledgers, entries, from, to, group.nature]);

  // T-format split: Dr balances on the left, Cr balances on the right
  const drRows: TRow[] = rows
    .filter((r2) => r2.closing_paise > 0)
    .map((r2) => ({
      label: (
        <span>
          {r2.name}{" "}
          <Badge variant="outline" className="ml-1 align-middle text-[10px]">{r2.type.replace(/_/g, " ")}</Badge>
        </span>
      ),
      amount: formatINR(r2.closing_paise),
      onClick: () => openLedgerReport(navigate, { ledgerId: r2.id, from, to }),
    }));
  const crRows: TRow[] = rows
    .filter((r2) => r2.closing_paise < 0)
    .map((r2) => ({
      label: (
        <span>
          {r2.name}{" "}
          <Badge variant="outline" className="ml-1 align-middle text-[10px]">{r2.type.replace(/_/g, " ")}</Badge>
        </span>
      ),
      amount: formatINR(-r2.closing_paise),
      onClick: () => openLedgerReport(navigate, { ledgerId: r2.id, from, to }),
    }));

  const drTotal = drRows.reduce((s, _, i) => s + (rows.filter((x) => x.closing_paise > 0)[i]?.closing_paise ?? 0), 0);
  const crTotal = crRows.reduce((s, _, i) => s + (-(rows.filter((x) => x.closing_paise < 0)[i]?.closing_paise ?? 0)), 0);

  const headers = ["Ledger", "Side", "Amount (₹)"];
  const tableRows = rows.map((row) => [row.name, row.closing_paise >= 0 ? "Dr" : "Cr", r(Math.abs(row.closing_paise))]);
  const fileBase = `${group.label.replace(/\s+/g, "_")}_${from}_to_${to}`;

  function exportCsv() {
    const lines = [headers.join(","), ...tableRows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${fileBase}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1 md:col-span-2">
            <Label>Group</Label>
            <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Balance Sheet</div>
                {GROUPS.filter((g) => g.section === "Balance Sheet").map((g) => (
                  <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                ))}
                <div className="px-2 py-1 mt-1 text-[10px] font-semibold uppercase text-muted-foreground">Profit & Loss</div>
                {GROUPS.filter((g) => g.section === "Profit & Loss").map((g) => (
                  <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <FyDatePicker value={from} onChange={setFrom} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <FyDatePicker value={to} onChange={setTo} />
          </div>
        </CardContent>
      </Card>

      <ReportToolbar
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        hideDates
        onExportCsv={exportCsv}
        onExportXlsx={() => downloadXlsx(`${fileBase}.xlsx`, [{ name: group.label.slice(0, 31), rows: [headers, ...tableRows] }])}
        onExportPdf={() => downloadPdfTable({ title: group.label, companyName: pdfHeader.companyName, companySubLine: pdfHeader.companySubLine, subtitle: `${group.section} · ${from} → ${to}`, head: [headers], body: tableRows, fileName: `${fileBase}.pdf`, rightAlignCols: [2] })}
        onPrint={() => window.print()}
        extra={<div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>}
      />

      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No ledgers in this group.</CardContent></Card>
      ) : view === "grid" ? (
        <Card><CardContent className="p-3">
          <DataGrid<typeof rows[number]>
            reportId={`group-ledger:${groupKey}`}
            rows={rows}
            columns={[
              { id: "name", header: "Ledger", type: "text", width: 280, accessor: (x) => x.name, groupable: true },
              { id: "type", header: "Type", type: "enum", width: 140, accessor: (x) => x.type.replace(/_/g, " "), groupable: true },
              { id: "opening", header: "Opening", type: "number", width: 140, align: "right", accessor: (x) => x.opening_paise / 100, cell: (x) => formatINR(x.opening_paise, { symbol: false }), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
              { id: "debit", header: "Debit", type: "number", width: 140, align: "right", accessor: (x) => x.debit_paise / 100, cell: (x) => x.debit_paise ? formatINR(x.debit_paise, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
              { id: "credit", header: "Credit", type: "number", width: 140, align: "right", accessor: (x) => x.credit_paise / 100, cell: (x) => x.credit_paise ? formatINR(x.credit_paise, { symbol: false }) : "", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100), { symbol: false }) },
              { id: "closing", header: "Closing", type: "number", width: 160, align: "right", accessor: (x) => x.closing_paise / 100, cell: (x) => `${formatINR(Math.abs(x.closing_paise), { symbol: false })} ${x.closing_paise >= 0 ? "Dr" : "Cr"}`, aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(Math.abs(v) * 100), { symbol: false }) },
            ] satisfies DGColumn<typeof rows[number]>[]}
            onRowClick={(x) => openLedgerReport(navigate, { ledgerId: x.id, from, to })}
            globalSearch={(x) => `${x.name} ${x.type}`}
            height={520}
          />
        </CardContent></Card>
      ) : (
        <TAccount
          title={group.label}
          subtitle={`${group.section} · ${from} to ${to}`}
          leftHeader="Dr. Balances"
          rightHeader="Cr. Balances"
          leftRows={drRows}
          rightRows={crRows}
          leftTotal={formatINR(drTotal)}
          rightTotal={formatINR(crTotal)}
        />
      )}
    </div>
  );
}
