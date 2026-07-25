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

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      // Gross receipts = credit balance on income ledgers in the period.
      // Digital/Cash split = pro-rata Bank vs Cash contra across the same
      // vouchers (via fetchLedgerModeSplits — same engine that drives the
      // P&L / R&P inner-column breakdown, so numbers reconcile 1:1).
      const [ledgers, splits] = await Promise.all([
        readLedgers(activeCompanyId),
        fetchLedgerModeSplits(activeCompanyId, from, to, { excludeProfitLossClosingTransfers: true }),
      ]);
      const incomeIds = new Set(
        (ledgers as any[]).filter((l) => PL_INCOME.has(String(l.type))).map((l) => String(l.id)),
      );
      let gross = 0, digital = 0, cash = 0;
      for (const id of incomeIds) {
        const s = splits.get(id);
        if (!s) continue;
        // Income ledgers carry credit balance → net is negative; flip sign.
        gross   += Math.max(0, -(s.cashPaise + s.bankPaise + s.otherPaise));
        digital += Math.max(0, -s.bankPaise);
        cash    += Math.max(0, -s.cashPaise);
      }
      setGrossReceipts(gross);
      setDigitalReceipts(digital);
      setCashReceipts(cash);
    })();
  }, [activeCompanyId, from, to]);

  const result = useMemo(() => computePresumptive({
    scheme, mode, grossReceiptsPaise: grossReceipts, digitalReceiptsPaise: digitalReceipts,
  }), [scheme, mode, grossReceipts, digitalReceipts]);

  const pctUsed = result.eligibleThresholdPaise > 0
    ? Math.min(100, (grossReceipts / result.eligibleThresholdPaise) * 100)
    : 0;

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
