import * as React from "react";
import { cn } from "@/lib/utils";

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
  /** Amount in rupees, already formatted (e.g. "₹ 12,345.00") */
  amount: React.ReactNode;
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
        "flex items-start justify-between gap-3 px-3 py-2 text-sm",
        row.onClick && "cursor-pointer hover:bg-muted/40",
        weight,
      )}
      onClick={row.onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate">{row.label}</div>
        {row.hint && (
          <div className="truncate text-[11px] text-muted-foreground">{row.hint}</div>
        )}
      </div>
      <div className="whitespace-nowrap text-right font-mono tabular-nums">
        {row.amount}
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
  const max = Math.max(leftRows.length, rightRows.length);
  // pad shorter side with empty rows so the separator lines up
  const lpad: (TRow | null)[] = [...leftRows];
  const rpad: (TRow | null)[] = [...rightRows];
  while (lpad.length < max) lpad.push(null);
  while (rpad.length < max) rpad.push(null);

  return (
    <div className={cn("rounded-md border bg-card text-card-foreground", className)}>
      {(title || subtitle) && (
        <div className="border-b px-4 py-2 text-center print:py-1">
          {title && <div className="text-base font-semibold">{title}</div>}
          {subtitle && (
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
      )}
      {/* Column headers */}
      <div className="grid grid-cols-2 border-b bg-muted/30 text-xs font-semibold uppercase tracking-wide">
        <div className="flex items-center justify-between gap-3 border-r-2 border-foreground/40 px-3 py-1.5">
          <span>{leftHeader}</span>
          <span>{amountHeader}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span>{rightHeader}</span>
          <span>{amountHeader}</span>
        </div>
      </div>
      {/* Body */}
      <div className="grid grid-cols-2">
        {/* Left column (Dr) */}
        <div className="border-r-2 border-foreground/40">
          {lpad.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">—</div>
          ) : (
            lpad.map((row, i) => (
              <div
                key={`l-${i}`}
                className={cn(i !== 0 && "border-t border-border/70")}
              >
                {row ? <RowCell row={row} /> : <div className="px-3 py-2 text-sm">&nbsp;</div>}
              </div>
            ))
          )}
        </div>
        {/* Right column (Cr) */}
        <div>
          {rpad.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">—</div>
          ) : (
            rpad.map((row, i) => (
              <div
                key={`r-${i}`}
                className={cn(i !== 0 && "border-t border-border/70")}
              >
                {row ? <RowCell row={row} /> : <div className="px-3 py-2 text-sm">&nbsp;</div>}
              </div>
            ))
          )}
        </div>
      </div>
      {/* Totals strip */}
      <div className="grid grid-cols-2 border-t-2 border-foreground/60 bg-muted/40 text-sm font-semibold">
        <div className="flex items-center justify-between gap-3 border-r-2 border-foreground/40 px-3 py-2">
          <span>Total</span>
          <span className="font-mono tabular-nums">{leftTotal}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span>Total</span>
          <span className="font-mono tabular-nums">{rightTotal}</span>
        </div>
      </div>
    </div>
  );
}
