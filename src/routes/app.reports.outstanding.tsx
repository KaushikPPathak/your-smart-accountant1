import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { useFyAsOfState } from "@/components/reports/ReportToolbar";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";

export const Route = createFileRoute("/app/reports/outstanding")({
  head: () => ({ meta: [{ title: "Bill-by-Bill Outstanding — Reports" }] }),
  component: OutstandingPage,
});

interface InvRow {
  id: string;
  voucher_number: string;
  voucher_date: string;
  due_date: string | null;
  total_paise: number;
  party_ledger_id: string | null;
  voucher_type: string;
  ledgers: { name: string } | null;
}

interface AllocRow {
  invoice_voucher_id: string;
  amount_paise: number;
}

function OutstandingPage() {
  const { activeCompanyId } = useCompany();
  const [mode, setMode] = useState<"receivables" | "payables">("receivables");
  const { asOf, setAsOf } = useFyAsOfState();
  const [invs, setInvs] = useState<InvRow[]>([]);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    const type = mode === "receivables" ? "sales" : "purchase";
    Promise.all([
      supabase.from("vouchers")
        .select("id, voucher_number, voucher_date, due_date, total_paise, party_ledger_id, voucher_type, ledgers:party_ledger_id(name)")
        .eq("company_id", activeCompanyId)
        .eq("voucher_type", type)
        .lte("voucher_date", asOf)
        .order("voucher_date").order("voucher_number", { ascending: true }),
      supabase.from("bill_allocations")
        .select("invoice_voucher_id, amount_paise")
        .eq("company_id", activeCompanyId),
    ]).then(([v, a]) => {
      setInvs((v.data || []) as unknown as InvRow[]);
      setAllocs((a.data || []) as AllocRow[]);
      setLoading(false);
    });
  }, [activeCompanyId, mode, asOf]);

  const rows = useMemo(() => {
    const paidByInv = new Map<string, number>();
    for (const a of allocs) paidByInv.set(a.invoice_voucher_id, (paidByInv.get(a.invoice_voucher_id) || 0) + a.amount_paise);
    const today = new Date(asOf).getTime();
    return invs
      .map((inv) => {
        const paid = paidByInv.get(inv.id) || 0;
        const pending = inv.total_paise - paid;
        const dueIso = inv.due_date || inv.voucher_date;
        const days = Math.max(0, Math.floor((today - new Date(dueIso).getTime()) / 86400000));
        return { ...inv, paid_paise: paid, pending_paise: pending, days };
      })
      .filter((r) => r.pending_paise > 0)
      .sort((a, b) => b.days - a.days);
  }, [invs, allocs, asOf]);

  const totalPending = rows.reduce((s, r) => s + r.pending_paise, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "receivables" | "payables")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="receivables">Receivables (Sales)</SelectItem>
                <SelectItem value="payables">Payables (Purchase)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>As of</Label>
            <FyDatePicker value={asOf} onChange={setAsOf} />
          </div>
          <div className="flex items-end justify-end">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total Outstanding</div>
              <div className="text-xl font-semibold font-mono">{formatINR(totalPending)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bill #</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Bill Amount</TableHead>
                <TableHead className="text-right">Received/Paid</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">No outstanding bills 🎉</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.voucher_date}</TableCell>
                  <TableCell className="font-medium">{r.voucher_number}</TableCell>
                  <TableCell>{r.ledgers?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtIndianDate(r.due_date || r.voucher_date)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.paid_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(r.pending_paise)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.days > 90 ? "destructive" : r.days > 60 ? "default" : "secondary"}>{r.days}d</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
