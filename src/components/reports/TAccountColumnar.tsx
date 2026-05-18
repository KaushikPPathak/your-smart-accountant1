import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Columnar T-account: same column structure as the Grid view, split into
 * Dr (left) and Cr (right) halves with a thick center divider and
 * vertical gridlines between every column.
 *
 * Columns per side: Date | Particulars | Vch Type | Vch No | Chq/Ref | Amount
 */
export interface TColRow {
  date?: React.ReactNode;
  particulars: React.ReactNode;
  vchType?: React.ReactNode;
  vchNo?: React.ReactNode;
  chqRef?: React.ReactNode;
  amount: React.ReactNode;
  onClick?: () => void;
  emphasis?: "normal" | "bold" | "total";
}

export interface TAccountColumnarProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  leftRows: TColRow[];
  rightRows: TColRow[];
  leftTotal: React.ReactNode;
  rightTotal: React.ReactNode;
  closingLine?: React.ReactNode;
  className?: string;
}

const COL_HEADERS = ["Date", "Particulars", "Vch Type", "Vch No", "Chq/Ref", "Amount"] as const;

function Cells({ row, isLeftSide }: { row: TColRow | null; isLeftSide: boolean }) {
  const amountBorder = isLeftSide
    ? "border-r-2 border-foreground print:border-black"
    : "";
  if (!row) {
    return (
      <>
        <td className="border-r border-foreground/40 px-2 py-1.5 print:border-black/60">&nbsp;</td>
        <td className="border-r border-foreground/40 px-2 py-1.5 print:border-black/60">&nbsp;</td>
        <td className="border-r border-foreground/40 px-2 py-1.5 print:border-black/60">&nbsp;</td>
        <td className="border-r border-foreground/40 px-2 py-1.5 print:border-black/60">&nbsp;</td>
        <td className="border-r border-foreground/40 px-2 py-1.5 print:border-black/60">&nbsp;</td>
        <td className={cn("px-2 py-1.5", amountBorder)}>&nbsp;</td>
      </>
    );
  }
  const weight =
    row.emphasis === "total" ? "font-semibold" : row.emphasis === "bold" ? "font-medium" : "";
  const clickable = row.onClick ? "cursor-pointer hover:bg-muted/40" : "";
  const base = cn("px-2 py-1.5 text-[12px] align-top", weight, clickable);
  const border = "border-r border-foreground/40 print:border-black/60";
  const onClick = row.onClick;
  return (
    <>
      <td className={cn(base, border, "whitespace-nowrap")} onClick={onClick}>{row.date ?? ""}</td>
      <td className={cn(base, border, "break-words")} onClick={onClick}>{row.particulars}</td>
      <td className={cn(base, border, "whitespace-nowrap")} onClick={onClick}>{row.vchType ?? ""}</td>
      <td className={cn(base, border, "whitespace-nowrap")} onClick={onClick}>{row.vchNo ?? ""}</td>
      <td className={cn(base, border, "whitespace-nowrap")} onClick={onClick}>{row.chqRef ?? ""}</td>
      <td className={cn(base, amountBorder, "text-right font-mono tabular-nums whitespace-nowrap")} onClick={onClick}>
        {row.amount}
      </td>
    </>
  );
}

export function TAccountColumnar({
  title,
  subtitle,
  leftRows,
  rightRows,
  leftTotal,
  rightTotal,
  closingLine,
  className,
}: TAccountColumnarProps) {
  const max = Math.max(leftRows.length, rightRows.length);
  const lpad: (TColRow | null)[] = [...leftRows];
  const rpad: (TColRow | null)[] = [...rightRows];
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
          {title && <div className="text-base font-semibold">{title}</div>}
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      )}
      <table className="w-full table-fixed border-collapse text-[12px]">
        <colgroup>
          <col style={{ width: "7%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead>
          <tr className="bg-muted/60">
            <th colSpan={6} className="border-b-2 border-r-2 border-foreground px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide print:border-black">
              Dr.
            </th>
            <th colSpan={6} className="border-b-2 border-foreground px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide print:border-black">
              Cr.
            </th>
          </tr>
          <tr className="bg-muted/40">
            {COL_HEADERS.map((h, i) => (
              <th
                key={`lh-${i}`}
                className={cn(
                  "border-b-2 border-r border-foreground/40 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide print:border-black/60",
                  i === 5 && "text-right border-r-2 border-foreground print:border-black",
                )}
              >
                {h}
              </th>
            ))}
            {COL_HEADERS.map((h, i) => (
              <th
                key={`rh-${i}`}
                className={cn(
                  "border-b-2 border-foreground/40 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide print:border-black/60",
                  i < 5 && "border-r border-foreground/40 print:border-black/60",
                  i === 5 && "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {max === 0 ? (
            <tr>
              <td colSpan={12} className="px-3 py-6 text-center text-sm text-muted-foreground">—</td>
            </tr>
          ) : (
            lpad.map((lrow, i) => (
              <tr key={i} className="border-t border-foreground/40 print:border-black/60">
                <Cells row={lrow} isLeftSide />
                <Cells row={rpad[i]} isLeftSide={false} />
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground bg-muted/50 print:border-black">
            <td colSpan={5} className="border-r border-foreground/40 px-2 py-1.5 text-[12px] font-semibold print:border-black/60">
              Total
            </td>
            <td className="border-r-2 border-foreground px-2 py-1.5 text-right font-mono tabular-nums text-[12px] font-semibold print:border-black">
              {leftTotal}
            </td>
            <td colSpan={5} className="border-r border-foreground/40 px-2 py-1.5 text-[12px] font-semibold print:border-black/60">
              Total
            </td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[12px] font-semibold">
              {rightTotal}
            </td>
          </tr>
          {closingLine && (
            <tr className="border-t border-foreground/40 bg-muted/30 print:border-black/60">
              <td colSpan={12} className="px-2 py-1.5 text-right text-[12px] font-semibold">
                {closingLine}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
