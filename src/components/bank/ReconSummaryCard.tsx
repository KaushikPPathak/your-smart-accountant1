import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { fmtIndianDate } from "@/lib/format-date";
import type { ReconSummary } from "@/lib/bank/reconcile";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

export function ReconSummaryCard({ summary }: { summary: ReconSummary | null }) {
  if (!summary) return null;
  const diff = summary.differencePaise;
  return (
    <Card>
      <CardContent className="grid gap-2 p-3 md:grid-cols-2">
        <div className="space-y-1">
          <Row label={`Balance as per books${summary.asOn ? ` (as on ${fmtIndianDate(summary.asOn)})` : ""}`}
            value={formatINR(summary.bookBalancePaise)} />
          <Row label="Add: unreconciled credits in bank" value={formatINR(summary.unreconciledCreditPaise)} />
          <Row label="Less: unreconciled debits in bank" value={formatINR(summary.unreconciledDebitPaise)} />
          <Row label="Expected bank statement balance" value={formatINR(summary.expectedStatementPaise)} strong />
        </div>
        <div className="space-y-1">
          <Row label="Statement closing balance (from file)"
            value={summary.statementBalancePaise == null ? "—" : formatINR(summary.statementBalancePaise)} />
          <Row label="Difference"
            value={diff == null ? "—" : formatINR(diff)} strong />
          <div className="pt-1 text-xs text-muted-foreground">
            {diff == null
              ? "This statement file had no running balance column, so only line-level matching is checked."
              : diff === 0
                ? "Reconciled — books and bank agree."
                : "Difference is non-zero: review suggested / unmatched lines below."}
          </div>
          <div className="text-xs text-muted-foreground">
            {summary.counts.matched} matched · {summary.counts.suggested} suggested ·{" "}
            {summary.counts.unmatched} unmatched · {summary.counts.ignored} ignored
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
