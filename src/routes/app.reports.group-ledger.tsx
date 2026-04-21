import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { ReportToolbar } from "@/components/reports/ReportToolbar";
import { downloadXlsx, downloadPdfTable, r } from "@/lib/exporters";
import type { LedgerTypeValue } from "@/lib/constants";

export const Route = createFileRoute("/app/reports/group-ledger")({
  head: () => ({ meta: [{ title: "Group Ledger Report — Reports" }] }),
  component: GroupLedgerReport,
});

// Tally-style groupings — Balance Sheet & Profit/Loss buckets
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
  /** debit positive nature → asset/expense; credit positive → liability/income */
  nature: "debit" | "credit";
}

const GROUPS: GroupDef[] = [
  // Balance Sheet — Assets
  { key: "sundry_debtors", label: "Sundry Debtors", section: "Balance Sheet", types: ["sundry_debtor"], nature: "debit" },
  { key: "cash_in_hand", label: "Cash-in-Hand", section: "Balance Sheet", types: ["cash"], nature: "debit" },
  { key: "bank_accounts", label: "Bank Accounts", section: "Balance Sheet", types: ["bank"], nature: "debit" },
  { key: "fixed_assets", label: "Fixed Assets", section: "Balance Sheet", types: ["fixed_asset"], nature: "debit" },
  { key: "current_assets", label: "Current Assets", section: "Balance Sheet", types: ["current_asset"], nature: "debit" },
  { key: "stock_in_hand", label: "Stock-in-Hand", section: "Balance Sheet", types: ["stock_in_hand"], nature: "debit" },
  { key: "all_assets", label: "All Assets (combined)", section: "Balance Sheet", types: ["sundry_debtor", "cash", "bank", "fixed_asset", "current_asset", "stock_in_hand"], nature: "debit" },
  // Balance Sheet — Liabilities
  { key: "sundry_creditors", label: "Sundry Creditors", section: "Balance Sheet", types: ["sundry_creditor"], nature: "credit" },
  { key: "loans_liabilities", label: "Loans (Liability)", section: "Balance Sheet", types: ["loan_liability"], nature: "credit" },
  { key: "current_liabilities", label: "Current Liabilities", section: "Balance Sheet", types: ["current_liability"], nature: "credit" },
  { key: "duties_taxes", label: "Duties & Taxes", section: "Balance Sheet", types: ["duties_taxes"], nature: "credit" },
  { key: "capital", label: "Capital Account", section: "Balance Sheet", types: ["capital"], nature: "credit" },
  { key: "all_liabilities", label: "All Liabilities (combined)", section: "Balance Sheet", types: ["sundry_creditor", "loan_liability", "current_liability", "duties_taxes", "capital"], nature: "credit" },
  // P&L
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
}
interface EntryRow {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string } | null;
}

function GroupLedgerReport() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const [groupKey, setGroupKey] = useState<GroupKey>("sundry_debtors");
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), 3, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const group = useMemo(() => GROUPS.find((g) => g.key === groupKey)!, [groupKey]);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    Promise.all([
      supabase.from("ledgers")
        .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", activeCompanyId)
        .eq("is_active", true)
        .in("type", group.types)
        .order("name"),
      supabase.from("voucher_entries")
        .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
        .eq("vouchers.company_id", activeCompanyId)
        .lte("vouchers.voucher_date", to),
    ]).then(([l, e]) => {
      setLedgers((l.data || []) as LedgerRow[]);
      setEntries((e.data || []) as unknown as EntryRow[]);
      setLoading(false);
    });
  }, [activeCompanyId, group.types, to]);

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
      const op = opSign * l.opening_balance_paise; // +ve = debit
      const b = before.get(l.id) || { dr: 0, cr: 0 };
      const p = period.get(l.id) || { dr: 0, cr: 0 };
      const opening = op + (b.dr - b.cr);
      const closing = opening + (p.dr - p.cr);
      // Display in natural sign of group
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

  const totals = useMemo(() => ({
    opening: rows.reduce((s, r) => s + r.opening_paise, 0),
    debit: rows.reduce((s, r) => s + r.debit_paise, 0),
    credit: rows.reduce((s, r) => s + r.credit_paise, 0),
    closing: rows.reduce((s, r) => s + r.closing_paise, 0),
  }), [rows]);

  const headers = ["Ledger", "Opening", "Debit", "Credit", "Closing"];
  const tableRows = rows.map((row) => [row.name, r(row.opening_paise), r(row.debit_paise), r(row.credit_paise), r(row.closing_paise)]);
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
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
        onExportPdf={() => downloadPdfTable({ title: group.label, subtitle: `${group.section} · ${from} → ${to}`, head: [headers], body: tableRows, fileName: `${fileBase}.pdf`, rightAlignCols: [1, 2, 3, 4] })}
        onPrint={() => window.print()}
      />


      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ledger</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Closing ({group.nature === "debit" ? "Dr" : "Cr"})</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="p-6 text-center text-sm text-muted-foreground">No ledgers in this group.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate({ to: "/app/reports/ledger", search: { ledgerId: r.id, from, to } })}
                  title="Drill down to ledger statement"
                >
                  <TableCell>
                    <span className="font-medium hover:underline">{r.name}</span>
                    <Badge variant="outline" className="ml-2 text-[10px]">{r.type.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.opening_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.debit_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.credit_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(r.closing_paise)}</TableCell>
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow className="border-t-2 bg-muted/40">
                  <TableCell className="font-semibold">Total ({rows.length} ledgers)</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.opening)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.debit)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.credit)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totals.closing)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
