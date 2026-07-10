import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { useFyAsOfState } from "@/components/reports/ReportToolbar";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import {
  readVouchers,
  readLedgers,
  readBillAllocations,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/reports/ageing")({
  head: () => ({ meta: [{ title: "Ageing Analysis — Reports" }] }),
  component: AgeingPage,
});

const BUCKETS = [
  { key: "b0", label: "0–30", lo: 0, hi: 30 },
  { key: "b1", label: "31–60", lo: 31, hi: 60 },
  { key: "b2", label: "61–90", lo: 61, hi: 90 },
  { key: "b3", label: "90+", lo: 91, hi: Infinity },
] as const;

interface InvRow {
  id: string;
  voucher_date: string;
  due_date: string | null;
  total_paise: number;
  party_ledger_id: string | null;
  ledgers: { name: string } | null;
}

interface AllocRow { invoice_voucher_id: string; amount_paise: number }

function AgeingPage() {
  const { activeCompanyId } = useCompany();
  const [mode, setMode] = useState<"receivables" | "payables">("receivables");
  const { asOf, setAsOf } = useFyAsOfState();
  const [invs, setInvs] = useState<InvRow[]>([]);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const { view, setView } = useReportView("ageing");

  useEffect(() => {
    if (!activeCompanyId) return;
    const type = mode === "receivables" ? "sales" : "purchase";
    Promise.all([
      supabase.from("vouchers")
        .select("id, voucher_date, due_date, total_paise, party_ledger_id, ledgers:party_ledger_id(name)")
        .eq("company_id", activeCompanyId)
        .eq("voucher_type", type)
        .lte("voucher_date", asOf),
      supabase.from("bill_allocations")
        .select("invoice_voucher_id, amount_paise")
        .eq("company_id", activeCompanyId),
    ]).then(([v, a]) => {
      setInvs((v.data || []) as unknown as InvRow[]);
      setAllocs((a.data || []) as AllocRow[]);
    });
  }, [activeCompanyId, mode, asOf]);

  const partyRows = useMemo(() => {
    const paidByInv = new Map<string, number>();
    for (const a of allocs) paidByInv.set(a.invoice_voucher_id, (paidByInv.get(a.invoice_voucher_id) || 0) + a.amount_paise);
    const today = new Date(asOf).getTime();
    const byParty = new Map<string, { name: string; b0: number; b1: number; b2: number; b3: number; total: number }>();
    for (const inv of invs) {
      const pending = inv.total_paise - (paidByInv.get(inv.id) || 0);
      if (pending <= 0) continue;
      const dueIso = inv.due_date || inv.voucher_date;
      const days = Math.max(0, Math.floor((today - new Date(dueIso).getTime()) / 86400000));
      const key = inv.party_ledger_id || "_";
      const cur = byParty.get(key) || { name: inv.ledgers?.name || "—", b0: 0, b1: 0, b2: 0, b3: 0, total: 0 };
      const bIdx = days <= 30 ? "b0" : days <= 60 ? "b1" : days <= 90 ? "b2" : "b3";
      cur[bIdx] += pending;
      cur.total += pending;
      byParty.set(key, cur);
    }
    return Array.from(byParty.values()).sort((a, b) => b.total - a.total);
  }, [invs, allocs, asOf]);

  const totals = useMemo(() => {
    return partyRows.reduce((acc, r) => ({
      b0: acc.b0 + r.b0, b1: acc.b1 + r.b1, b2: acc.b2 + r.b2, b3: acc.b3 + r.b3, total: acc.total + r.total,
    }), { b0: 0, b1: 0, b2: 0, b3: 0, total: 0 });
  }, [partyRows]);

  type PartyVm = (typeof partyRows)[number];
  const ageingGridColumns: DGColumn<PartyVm>[] = useMemo(() => [
    { id: "party", header: "Party", type: "text", width: 260, accessor: (x) => x.name, groupable: true },
    ...BUCKETS.map((b): DGColumn<PartyVm> => ({
      id: b.key, header: `${b.label} days`, type: "number", width: 120, align: "right",
      accessor: (x) => (x[b.key as "b0" | "b1" | "b2" | "b3"]) / 100,
      cell: (x) => formatINR(x[b.key as "b0" | "b1" | "b2" | "b3"]),
      aggregator: "sum",
      formatAggregate: (v) => formatINR(Math.round(v * 100)),
    })),
    {
      id: "total", header: "Total", type: "number", width: 140, align: "right",
      accessor: (x) => x.total / 100,
      cell: (x) => formatINR(x.total),
      aggregator: "sum",
      formatAggregate: (v) => formatINR(Math.round(v * 100)),
    },
  ], []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "receivables" | "payables")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="receivables">Receivables</SelectItem>
                <SelectItem value="payables">Payables</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>As of</Label>
            <FyDatePicker value={asOf} onChange={setAsOf} />
          </div>
          <div className="space-y-1 md:col-span-3">
            <ViewSwitcher view={view} onChange={setView} />
          </div>
        </CardContent>
      </Card>

      {view === "grid" ? (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId="ageing"
              rows={partyRows}
              columns={ageingGridColumns}
              globalSearch={(x) => x.name}
              height={520}
              empty="No outstanding."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  {BUCKETS.map((b) => <TableHead key={b.key} className="text-right">{b.label} days</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partyRows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="p-6 text-center text-sm text-muted-foreground">No outstanding</TableCell></TableRow>
                ) : partyRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.b0)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.b1)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.b2)}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{formatINR(r.b3)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatINR(r.total)}</TableCell>
                  </TableRow>
                ))}
                {partyRows.length > 0 && (
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(totals.b0)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(totals.b1)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(totals.b2)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(totals.b3)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(totals.total)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
