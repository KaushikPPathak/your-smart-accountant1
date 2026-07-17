import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  loadRecentLedgerEntries,
  useLedgerBalance,
  type LedgerRecentEntry,
} from "@/lib/balances-cache";

interface Props {
  ledgerId: string | null | undefined;
  /** Optional label prefix rendered inside the chip. e.g. "Party", "Cash". */
  prefix?: string;
  className?: string;
  /** Compact = smaller (used inside grid rows). */
  compact?: boolean;
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
  quotation: "Quote",
  sales_order: "SO",
  delivery_note: "DN",
  manufacturing: "Mfg",
};

function fmtDate(d: string) {
  // Expect YYYY-MM-DD — render DD-MMM to keep the popover compact.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${m[3]}-${months[Number(m[2]) - 1]}`;
}

export function LedgerBalanceChip({ ledgerId, prefix, className, compact }: Props) {
  const balance = useLedgerBalance(ledgerId);
  const [open, setOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<LedgerRecentEntry[]>([]);

  React.useEffect(() => {
    if (!open || !ledgerId) return;
    let cancelled = false;
    void loadRecentLedgerEntries(ledgerId, 10).then((rows) => {
      if (!cancelled) setRecent(rows);
    });
    return () => { cancelled = true; };
  }, [open, ledgerId]);

  if (!ledgerId || !balance) return null;

  const abs = Math.abs(balance.paise);
  const drCr = balance.paise >= 0 ? "Dr" : "Cr";
  const tone =
    balance.paise === 0
      ? "text-muted-foreground"
      : balance.paise > 0
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-rose-700 dark:text-rose-400";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Click for last 10 entries"
          className={cn(
            "inline-flex items-center gap-1 rounded border bg-muted/40 font-mono hover:bg-muted",
            compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
            className,
          )}
        >
          {prefix && <span className="text-muted-foreground">{prefix}:</span>}
          <span className={tone}>{formatINR(abs)}</span>
          <span className={cn("font-semibold", tone)}>{drCr}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-semibold">{balance.name}</div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Closing balance</span>
            <span className={cn("font-mono font-semibold", tone)}>
              {formatINR(abs)} {drCr}
            </span>
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {recent.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No transactions yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Date</th>
                  <th className="px-2 py-1 text-left font-medium">Type</th>
                  <th className="px-2 py-1 text-left font-medium">Ref</th>
                  <th className="px-2 py-1 text-right font-medium">Debit</th>
                  <th className="px-2 py-1 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={r.voucher_id + i} className="odd:bg-muted/30">
                    <td className="px-2 py-1 font-mono">{fmtDate(r.voucher_date)}</td>
                    <td className="px-2 py-1">{TYPE_LABEL[r.voucher_type ?? ""] ?? r.voucher_type ?? ""}</td>
                    <td className="px-2 py-1 font-mono">{r.voucher_number ?? "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {r.debit_paise ? formatINR(r.debit_paise) : ""}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {r.credit_paise ? formatINR(r.credit_paise) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          Showing last {recent.length} of most recent entries.
        </div>
      </PopoverContent>
    </Popover>
  );
}
