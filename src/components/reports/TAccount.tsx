import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";

function loc(node: React.ReactNode, lang: string): React.ReactNode {
  return typeof node === "string" ? tReportText(node, lang as never) : node;
}

/**
 * T-format account renderer.
 * Renders a classic two-column ledger layout:
 *   Dr (left)  ‖  Cr (right)
 * with a thick vertical separator and a horizontal rule between every entry,
 * matching a manual ledger book / Excel sheet feel.
 */
export interface TRow {
  /** Particulars text (e.g. "To Sales A/c", "By Cash A/c", or just a name) */
  label: React.ReactNode;
  /** Optional small detail line under the label (date, voucher no., etc.) */
  hint?: React.ReactNode;
  /** Amount in the inner (ledger-level) column */
  amount: React.ReactNode;
  /** Amount in the outer (group subtotal / grand) column */
  outerAmount?: React.ReactNode;
  /** Optional click handler for drill-down */
  onClick?: () => void;
  /** Mark as bold/total/c-d style */
  emphasis?: "normal" | "bold" | "total";
}

export interface TAccountProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Header for left column. Default: "Dr.  Particulars" */
  leftHeader?: React.ReactNode;
  /** Header for right column. Default: "Particulars  Cr." */
  rightHeader?: React.ReactNode;
  /** Small "Amount (₹)" sub-header label, shown above the amount column */
  amountHeader?: React.ReactNode;
  leftRows: TRow[];
  rightRows: TRow[];
  /** Total rows shown in the bold totals strip at the bottom */
  leftTotal: React.ReactNode;
  rightTotal: React.ReactNode;
  /** Show "₹" prefix in amount header. Default true. */
  className?: string;
}

function RowCell({ row }: { row: TRow }) {
  const weight =
    row.emphasis === "total"
      ? "font-semibold"
      : row.emphasis === "bold"
        ? "font-medium"
        : "";
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2 py-1.5 text-[12px] leading-tight",
        row.onClick && "cursor-pointer hover:bg-muted/40",
        weight,
      )}
      onClick={row.onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate">{row.label}</div>
        {row.hint && (
          <div className="truncate text-[10px] text-muted-foreground">{row.hint}</div>
        )}
      </div>
      <div className="w-[6.5rem] shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-[12px]">
        {row.amount}
      </div>
      <div className="w-[6.5rem] shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-[12px]">
        {row.outerAmount}
      </div>
    </div>
  );
}

export function TAccount({
  title,
  subtitle,
  leftHeader = "Dr.  Particulars",
  rightHeader = "Particulars  Cr.",
  amountHeader = "Amount (₹)",
  leftRows,
  rightRows,
  leftTotal,
  rightTotal,
  className,
}: TAccountProps) {
  const { lang } = useI18n();
  const totalLabel = tReportText("Total", lang);
  const max = Math.max(leftRows.length, rightRows.length);
  // pad shorter side with empty rows so the separator lines up
  const lpad: (TRow | null)[] = [...leftRows];
  const rpad: (TRow | null)[] = [...rightRows];
  while (lpad.length < max) lpad.push(null);
  while (rpad.length < max) rpad.push(null);

  return (
    <div
      className={cn(
        "w-full max-w-full overflow-hidden rounded-md border-2 border-foreground bg-card text-card-foreground print:border-black",
        className,
      )}
    >
      {(title || subtitle) && (
        <div className="border-b-2 border-foreground px-4 py-2 text-center print:border-black print:py-1">
          {title && <div className="text-base font-semibold">{loc(title, lang)}</div>}
          {subtitle && (
            <div className="text-xs text-muted-foreground">{loc(subtitle, lang)}</div>
          )}
        </div>
      )}
      {/* Column headers */}
      <div className="grid grid-cols-2 border-b-2 border-foreground bg-muted/40 text-[11px] font-semibold uppercase tracking-wide print:border-black">
        <div className="flex min-w-0 items-center gap-2 border-r-2 border-foreground px-2 py-1.5 print:border-black">
          <span className="min-w-0 flex-1 truncate">{loc(leftHeader, lang)}</span>
          <span className="w-[13rem] shrink-0 whitespace-nowrap text-right">{loc(amountHeader, lang)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate">{loc(rightHeader, lang)}</span>
          <span className="w-[13rem] shrink-0 whitespace-nowrap text-right">{loc(amountHeader, lang)}</span>
        </div>
      </div>
      {/* Body */}
      <div className="grid grid-cols-2">
        {/* Left column (Dr) */}
        <div className="min-w-0 border-r-2 border-foreground print:border-black">
          {lpad.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">—</div>
          ) : (
            lpad.map((row, i) => (
              <div
                key={`l-${i}`}
                className={cn(i !== 0 && "border-t border-foreground/60 print:border-black")}
              >
                {row ? <RowCell row={row} /> : <div className="px-2 py-1.5 text-[12px]">&nbsp;</div>}
              </div>
            ))
          )}
        </div>
        {/* Right column (Cr) */}
        <div className="min-w-0">
          {rpad.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">—</div>
          ) : (
            rpad.map((row, i) => (
              <div
                key={`r-${i}`}
                className={cn(i !== 0 && "border-t border-foreground/60 print:border-black")}
              >
                {row ? <RowCell row={row} /> : <div className="px-2 py-1.5 text-[12px]">&nbsp;</div>}
              </div>
            ))
          )}
        </div>
      </div>
      {/* Totals strip */}
      <div className="grid grid-cols-2 border-t-2 border-foreground bg-muted/50 text-[12px] font-semibold print:border-black">
        <div className="flex min-w-0 items-center justify-between gap-2 border-r-2 border-foreground px-2 py-1.5 print:border-black">
          <span className="truncate">{totalLabel}</span>
          <span className="whitespace-nowrap font-mono tabular-nums">{leftTotal}</span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5">
          <span className="truncate">{totalLabel}</span>
          <span className="whitespace-nowrap font-mono tabular-nums">{rightTotal}</span>
        </div>
      </div>
    </div>
  );
}
