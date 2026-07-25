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
import { sortVouchersAsc } from "@/lib/voucher-sort";
import {
  readVouchers,
  readLedgers,
  readBillAllocations,
  withCacheFallback,
} from "@/lib/offline/cache-read";
import {
  msmedInterestPaise,
  msmedInterestBreakdown,
  DEFAULT_RBI_BANK_RATE_PCT,
} from "@/lib/msme-interest";

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
  ledgers: { name: string; msme_registered?: boolean | null } | null;
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
  const rateKey = `msme:bankRate:${activeCompanyId ?? "_"}`;
  const [bankRate, setBankRate] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_RBI_BANK_RATE_PCT;
    const v = Number(window.localStorage.getItem(rateKey));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_RBI_BANK_RATE_PCT;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(rateKey, String(bankRate));
  }, [bankRate, rateKey]);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    const type = mode === "receivables" ? "sales" : "purchase";
    withCacheFallback<{ invs: InvRow[]; allocs: AllocRow[] }>(
      async () => {
        const [v, a] = await Promise.all([
          supabase.from("vouchers")
            .select("id, voucher_number, voucher_date, due_date, total_paise, party_ledger_id, voucher_type, ledgers:party_ledger_id(name, msme_registered)")
            .eq("company_id", activeCompanyId)
            .eq("voucher_type", type)
            .lte("voucher_date", asOf)
            .order("voucher_date").order("voucher_number", { ascending: true }),
          supabase.from("bill_allocations")
            .select("invoice_voucher_id, amount_paise")
            .eq("company_id", activeCompanyId),
        ]);
        return {
          invs: (v.data || []) as unknown as InvRow[],
          allocs: (a.data || []) as AllocRow[],
        };
      },
      async () => {
        const [vouchers, ledgers, allocRows] = await Promise.all([
          readVouchers(activeCompanyId, { voucher_type: type, to: asOf }),
          readLedgers(activeCompanyId),
          readBillAllocations(activeCompanyId),
        ]);
        const ledgerById = new Map((ledgers as any[]).map((l) => [String(l.id), l]));
        return {
          invs: (vouchers as any[]).map((v) => ({
            id: String(v.id),
            voucher_number: String(v.voucher_number ?? ""),
            voucher_date: String(v.voucher_date ?? ""),
            due_date: v.due_date ?? null,
            total_paise: Number(v.total_paise || 0),
            party_ledger_id: v.party_ledger_id ?? null,
            voucher_type: String(v.voucher_type ?? ""),
            ledgers: v.party_ledger_id
              ? {
                  name: ledgerById.get(String(v.party_ledger_id))?.name ?? "",
                  msme_registered: !!ledgerById.get(String(v.party_ledger_id))?.msme_registered,
                }
              : null,
          })) as InvRow[],
          allocs: (allocRows as any[]).map((a) => ({
            invoice_voucher_id: String(a.invoice_voucher_id),
            amount_paise: Number(a.amount_paise || 0),
          })),
        };
      },
    ).then(({ invs, allocs }) => {
      setInvs(sortVouchersAsc(invs));
      setAllocs(allocs);
      setLoading(false);
    }).catch(() => setLoading(false));
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
  // MSMED §15/§16 — flag payables past appointed day, compute compound interest.
  const msmeRows = useMemo(() => {
    if (mode !== "payables") return [] as Array<typeof rows[number] & { interest_paise: number; appointed_day: string; days_late: number }>;
    return rows
      .filter((r) => r.ledgers?.msme_registered)
      .map((r) => {
        const b = msmedInterestBreakdown(r.pending_paise, r.voucher_date, asOf, {
          agreedDueDate: r.due_date,
          bankRatePct: bankRate,
        });
        return { ...r, interest_paise: b.interestPaise, appointed_day: b.appointedDay, days_late: b.daysLate };
      })
      .filter((r) => r.days_late > 0);
  }, [rows, mode, asOf, bankRate]);
  const msmeOverdueTotal = msmeRows.reduce((s, r) => s + r.pending_paise, 0);
  const msmeInterestTotal = msmeRows.reduce((s, r) => s + r.interest_paise, 0);


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

      {mode === "payables" && msmeRows.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-[240px]">
              <div className="text-sm font-semibold text-destructive">
                MSMED §15/§16 alert — {msmeRows.length} bill{msmeRows.length === 1 ? "" : "s"} past appointed day
              </div>
              <div className="text-xs text-muted-foreground">
                Compound interest @ 3× RBI bank rate ({(bankRate * 3).toFixed(2)}% p.a., monthly rests)
                from day after appointed day. Also disallowed u/s 43B(h) of the Income-tax Act until paid.
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">RBI bank rate %</Label>
                <Input
                  type="number"
                  step="0.05"
                  value={bankRate}
                  onChange={(e) => setBankRate(Math.max(0, Number(e.target.value) || 0))}
                  className="h-8 w-24 font-mono"
                />
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Principal overdue</div>
                <div className="font-mono text-base font-semibold text-destructive">{formatINR(msmeOverdueTotal)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">§16 interest</div>
                <div className="font-mono text-base font-semibold text-destructive">{formatINR(msmeInterestTotal)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}


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
              ) : rows.map((r) => {
                const isMsmeOverdue = mode === "payables" && !!r.ledgers?.msme_registered && r.days > 45;
                return (
                <TableRow key={r.id} className={isMsmeOverdue ? "bg-destructive/5" : undefined}>
                  <TableCell className="font-mono text-xs">{fmtIndianDate(r.voucher_date)}</TableCell>
                  <TableCell className="font-medium">{r.voucher_number}</TableCell>
                  <TableCell>
                    <span>{r.ledgers?.name || "—"}</span>
                    {r.ledgers?.msme_registered && (
                      <Badge variant="outline" className="ml-2 border-amber-500 text-amber-700 dark:text-amber-400">MSME</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{fmtIndianDate(r.due_date || r.voucher_date)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(r.paid_paise)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(r.pending_paise)}</TableCell>
                  <TableCell className="text-right">
                    {isMsmeOverdue ? (
                      <Badge variant="destructive" title="MSMED §15 / Sec 43B(h) — overdue beyond 45 days">{r.days}d ⚠</Badge>
                    ) : (
                      <Badge variant={r.days > 90 ? "destructive" : r.days > 60 ? "default" : "secondary"}>{r.days}d</Badge>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
