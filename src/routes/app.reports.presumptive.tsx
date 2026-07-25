import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";

import { formatINR } from "@/lib/money";
import { computePresumptive, type PresumptiveScheme, type PresumptiveMode } from "@/lib/presumptive";
import { fetchLedgerModeSplits, PL_INCOME, isProfitLossClosingTransfer } from "@/lib/reports";
import { readLedgers, readVouchers, readVoucherEntriesForCompany } from "@/lib/offline/cache-read";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

type VoucherBreakdownRow = {
  voucherId: string;
  date: string;
  number: string;
  type: string;
  narration: string;
  cashPaise: number;
  bankPaise: number;
  otherPaise: number;
  totalPaise: number;
};

export const Route = createFileRoute("/app/reports/presumptive")({
  head: () => ({ meta: [{ title: "Presumptive Taxation (44AD / 44ADA) — Reports" }] }),
  component: PresumptivePage,
});

function PresumptivePage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const currency = activeMembership?.companies?.currency_code ?? "INR";
  const scheme = ((activeMembership?.companies as unknown as { presumptive_scheme?: PresumptiveScheme })?.presumptive_scheme
    ?? "none") as PresumptiveScheme;
  const mode = ((activeMembership?.companies as unknown as { presumptive_mode?: PresumptiveMode })?.presumptive_mode
    ?? "cash") as PresumptiveMode;

  const [grossReceipts, setGrossReceipts] = useState(0);
  const [digitalReceipts, setDigitalReceipts] = useState(0);
  const [cashReceipts, setCashReceipts] = useState(0);
  const [rows, setRows] = useState<VoucherBreakdownRow[]>([]);
  const [drill, setDrill] = useState<null | "all" | "digital" | "cash" | "other">(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [ledgers, splits, vouchers, entries] = await Promise.all([
        readLedgers(activeCompanyId),
        fetchLedgerModeSplits(activeCompanyId, from, to, { excludeProfitLossClosingTransfers: true }),
        readVouchers(activeCompanyId),
        readVoucherEntriesForCompany(activeCompanyId),
      ]);
      const incomeIds = new Set(
        (ledgers as any[]).filter((l) => PL_INCOME.has(String(l.type))).map((l) => String(l.id)),
      );
      let gross = 0, digital = 0, cash = 0;
      for (const id of incomeIds) {
        const s = splits.get(id);
        if (!s) continue;
        gross   += Math.max(0, -(s.cashPaise + s.bankPaise + s.otherPaise));
        digital += Math.max(0, -s.bankPaise);
        cash    += Math.max(0, -s.cashPaise);
      }
      setGrossReceipts(gross);
      setDigitalReceipts(digital);
      setCashReceipts(cash);

      // Per-voucher contribution to income ledgers (pro-rata cash vs bank).
      const typeOf = new Map((ledgers as any[]).map((l) => [String(l.id), String(l.type ?? "")]));
      const vById = new Map((vouchers as any[]).map((v) => [String(v.id), v]));
      const byVoucher = new Map<string, any[]>();
      for (const e of entries as any[]) {
        const v = vById.get(String(e.voucher_id));
        if (!v) continue;
        const d = String(v.voucher_date ?? v.date ?? "");
        if (d < from || d > to) continue;
        if (isProfitLossClosingTransfer({ voucher_type: v.voucher_type ?? null, narration: v.narration ?? null })) continue;
        const arr = byVoucher.get(String(e.voucher_id)) ?? [];
        arr.push(e);
        byVoucher.set(String(e.voucher_id), arr);
      }
      const built: VoucherBreakdownRow[] = [];
      for (const [vid, es] of byVoucher) {
        let cashNet = 0, bankNet = 0;
        for (const e of es) {
          const t = typeOf.get(String(e.ledger_id));
          const m = (Number(e.debit_paise) || 0) - (Number(e.credit_paise) || 0);
          if (t === "cash") cashNet += m;
          else if (t === "bank") bankNet += m;
        }
        const cashAbs = Math.abs(cashNet), bankAbs = Math.abs(bankNet), totalAbs = cashAbs + bankAbs;
        let cP = 0, bP = 0, oP = 0;
        for (const e of es) {
          const lid = String(e.ledger_id);
          if (!incomeIds.has(lid)) continue;
          const m = (Number(e.debit_paise) || 0) - (Number(e.credit_paise) || 0);
          if (!m) continue;
          // Income credit → contribution to gross is -m (positive).
          if (totalAbs === 0) {
            oP += -m;
          } else {
            const cashShare = Math.round((m * cashAbs) / totalAbs);
            const bankShare = m - cashShare;
            cP += -cashShare;
            bP += -bankShare;
          }
        }
        const total = cP + bP + oP;
        if (total <= 0) continue;
        const v = vById.get(vid)!;
        built.push({
          voucherId: vid,
          date: String(v.voucher_date ?? v.date ?? ""),
          number: String(v.voucher_number ?? ""),
          type: String(v.voucher_type ?? ""),
          narration: String(v.narration ?? ""),
          cashPaise: cP,
          bankPaise: bP,
          otherPaise: oP,
          totalPaise: total,
        });
      }
      built.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      setRows(built);
    })();
  }, [activeCompanyId, from, to]);

  const result = useMemo(() => computePresumptive({
    scheme, mode, grossReceiptsPaise: grossReceipts, digitalReceiptsPaise: digitalReceipts,
  }), [scheme, mode, grossReceipts, digitalReceipts]);

  const pctUsed = result.eligibleThresholdPaise > 0
    ? Math.min(100, (grossReceipts / result.eligibleThresholdPaise) * 100)
    : 0;

  const filteredRows = useMemo(() => {
    if (!drill || drill === "all") return rows;
    if (drill === "digital") return rows.filter((r) => r.bankPaise > 0);
    if (drill === "cash") return rows.filter((r) => r.cashPaise > 0);
    return rows.filter((r) => r.otherPaise > 0);
  }, [rows, drill]);

  return (
    <div className="space-y-4">
      <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {scheme === "none" ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm">
              Presumptive taxation is not enabled for this company. Turn it on from
              <strong> Settings → Compliance</strong> and pick §44AD (small business) or §44ADA (professional).
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                {scheme === "44ad" ? "Section 44AD — Small Business" : "Section 44ADA — Professional"}
                <Badge variant={result.thresholdBreached ? "destructive" : "secondary"}>
                  {result.thresholdBreached ? "Threshold breached" : "Within limits"}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Stat label="Gross receipts (period)" value={formatINR(grossReceipts)} />
                <Stat label={`Deemed profit @ ${result.effectiveRatePct}%`} value={formatINR(result.deemedProfitPaise)} />
                <Stat label="Eligible threshold" value={formatINR(result.eligibleThresholdPaise)} sub={result.usesExtendedLimit ? "Extended (≥95% digital receipts)" : "Base cap"} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span>Turnover used vs. cap</span>
                  <span>{pctUsed.toFixed(1)}%</span>
                </div>
                <Progress value={pctUsed} className={pctUsed >= 90 ? "bg-red-100" : ""} />
              </div>
              <div className="grid gap-3 md:grid-cols-3 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Digital receipts (Bank/UPI/Cheque)</div>
                  <div className="font-mono">{formatINR(digitalReceipts)}</div>
                  <div className="text-xs">{result.digitalSharePct.toFixed(2)}% of gross</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Cash receipts</div>
                  <div className="font-mono">{formatINR(cashReceipts)}</div>
                  <div className="text-xs">
                    {grossReceipts > 0 ? ((cashReceipts / grossReceipts) * 100).toFixed(2) : "0.00"}% of gross
                    {scheme === "44ad" && grossReceipts > 0 && (cashReceipts / grossReceipts) > 0.05 && (
                      <span className="ml-1 text-destructive">· &gt; 5% cash blocks ₹3 Cr extended cap</span>
                    )}
                  </div>
                </div>
                <div className={`rounded-md border p-3 flex items-start gap-2 ${result.thresholdBreached ? "border-destructive/50 bg-destructive/5" : result.usesExtendedLimit ? "border-green-500/40 bg-green-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  {result.thresholdBreached
                    ? <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                    : <CheckCircle2 className={`mt-0.5 h-4 w-4 ${result.usesExtendedLimit ? "text-green-600" : "text-amber-600"}`} />}
                  <div className="text-xs">
                    {result.thresholdBreached
                      ? "Turnover exceeds the applicable cap — presumptive scheme not available this year. Tax audit u/s 44AB may apply; consult your CA."
                      : result.usesExtendedLimit
                        ? `Digital share ≥ 95% — extended cap of ${formatINR(result.eligibleThresholdPaise)} applies (proviso to §44AD(1)).`
                        : `Digital share is ${result.digitalSharePct.toFixed(2)}% (needs ≥ 95%) — base cap of ${formatINR(result.eligibleThresholdPaise)} applies. Route more receipts through bank to unlock extended cap.`}
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
