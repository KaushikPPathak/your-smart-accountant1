import React from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface TRow {
  label: string;
  amount: string;
  emphasis?: "normal" | "bold" | "total";
  isHeader?: boolean;
  isFooter?: boolean;
  isSubLedger?: boolean;
  isCashBankSplit?: boolean;
  indent?: number;
  onClick?: () => void;
}

export interface TAccountProps {
  title: string;
  subtitle?: string;
  leftRows: TRow[];
  rightRows: TRow[];
  leftTotal: string;
  rightTotal: string;
  leftHeaderLabel?: string;
  rightHeaderLabel?: string;
  className?: string;
}

export function TAccount({
  title,
  subtitle,
  leftRows,
  rightRows,
  leftTotal,
  rightTotal,
  leftHeaderLabel = "Dr. Particulars",
  rightHeaderLabel = "Cr. Particulars",
  className,
}: TAccountProps) {
  const maxRows = Math.max(leftRows.length, rightRows.length);
  const paddedLeft: (TRow | null)[] = [...leftRows];
  while (paddedLeft.length < maxRows) paddedLeft.push(null);

  const paddedRight: (TRow | null)[] = [...rightRows];
  while (paddedRight.length < maxRows) paddedRight.push(null);

  const renderRow = (row: TRow | null, index: number, side: "left" | "right") => {
    if (!row) {
      return (
        <TableRow key={`${side}-empty-${index}`} className="border-b border-transparent h-7">
          <TableCell className="py-1 px-2 text-xs">&nbsp;</TableCell>
          <TableCell className="py-1 px-2 text-right text-xs">&nbsp;</TableCell>
        </TableRow>
      );
    }

    const isClickable = Boolean(row.onClick);
    const isBold = row.emphasis === "bold" || row.emphasis === "total" || row.isHeader || row.isFooter;
    const isTotal = row.emphasis === "total";
    const indentLevel = row.indent ?? (row.isSubLedger ? 2 : row.isCashBankSplit ? 3 : row.isHeader ? 0 : 1);

    return (
      <TableRow
        key={`${side}-${index}-${row.label}`}
        onClick={row.onClick}
        className={cn(
          "border-b border-border/40 transition-colors",
          isClickable && "cursor-pointer hover:bg-muted/60",
          row.isHeader && "bg-muted/20 font-semibold",
          row.isFooter && "bg-muted/10 font-medium",
          isTotal && "font-bold text-primary",
          row.isCashBankSplit && "text-muted-foreground text-[11px]"
        )}
        title={isClickable ? "Click to view ledger details" : undefined}
      >
        <TableCell
          className={cn(
            "py-1 px-2 text-xs select-text",
            isBold && "font-semibold",
            row.isCashBankSplit && "text-[11px] text-muted-foreground"
          )}
          style={{ paddingLeft: `${Math.max(8, indentLevel * 12)}px` }}
        >
          {row.label}
        </TableCell>
        <TableCell
          className={cn(
            "py-1 px-2 text-right font-mono text-xs whitespace-nowrap select-text",
            isBold && "font-semibold",
            row.isCashBankSplit && "text-[11px] text-muted-foreground"
          )}
        >
          {row.amount}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className={cn("w-full space-y-4 print:space-y-2", className)}>
      {/* Print stylesheet to enforce A4 landscape and dual-column T-shape */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm 10mm;
          }
          .t-account-print-wrapper {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            width: 100% !important;
            gap: 12px !important;
          }
          .t-account-print-col {
            width: 100% !important;
            min-width: 0 !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Report Header */}
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight print:text-lg">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground print:text-xs">{subtitle}</p>}
      </div>

      {/* Main Dual-Column T-Account Container */}
      <div className="t-account-print-wrapper print-avoid-break grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-2 text-card-foreground shadow-sm print:grid-cols-2 print:gap-2 print:border print:p-1 print:shadow-none">
        
        {/* Debit Side (Left) */}
        <div className="t-account-print-col min-w-0 border-r border-border pr-2 print:pr-1">
          <Table className="w-full">
            <TableHeader>
              <TableRow className="border-b-2 border-border bg-muted/40">
                <TableHead className="py-2 px-2 font-bold text-foreground print:text-xs">{leftHeaderLabel}</TableHead>
                <TableHead className="py-2 px-2 text-right font-bold text-foreground print:text-xs">Amount (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paddedLeft.map((row, idx) => renderRow(row, idx, "left"))}
            </TableBody>
            <TableFooter>
              <TableRow className="border-t-2 border-double border-foreground font-bold bg-muted/30">
                <TableCell className="py-2 px-2 text-xs uppercase tracking-wider print:py-1">Total</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono text-xs print:py-1">{leftTotal}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        {/* Credit Side (Right) */}
        <div className="t-account-print-col min-w-0 pl-2 print:pl-1">
          <Table className="w-full">
            <TableHeader>
              <TableRow className="border-b-2 border-border bg-muted/40">
                <TableHead className="py-2 px-2 font-bold text-foreground print:text-xs">{rightHeaderLabel}</TableHead>
                <TableHead className="py-2 px-2 text-right font-bold text-foreground print:text-xs">Amount (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paddedRight.map((row, idx) => renderRow(row, idx, "right"))}
            </TableBody>
            <TableFooter>
              <TableRow className="border-t-2 border-double border-foreground font-bold bg-muted/30">
                <TableCell className="py-2 px-2 text-xs uppercase tracking-wider print:py-1">Total</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono text-xs print:py-1">{rightTotal}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

      </div>
    </div>
  );
}
