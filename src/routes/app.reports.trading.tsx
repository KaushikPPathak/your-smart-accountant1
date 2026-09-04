import React from "react";
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

  return (
    <div className={cn("w-full space-y-2", className)}>
      {/* Traditional Indian Accounting T-Frame Stylesheet */}
      <style>{`
        .t-account-table {
          width: 100% !important;
          border-collapse: collapse !important;
          border: 1.5px solid #000 !important;
          font-size: 8.5pt !important;
          background: #fff !important;
          color: #000 !important;
        }
        .t-account-table th {
          border-bottom: 1.5px solid #000 !important;
          background-color: #f2f2f2 !important;
          font-weight: 700 !important;
          padding: 4px 6px !important;
          color: #000 !important;
        }
        .t-account-table td {
          border-bottom: 0.5px solid #d0d0d0 !important;
          padding: 2.5px 6px !important;
          vertical-align: top !important;
          color: #000 !important;
        }
        /* Vertical Column Dividers */
        .col-divider {
          border-right: 0.5px solid #b0b0b0 !important;
        }
        .center-t-divider {
          border-right: 2px solid #000 !important;
        }
        /* Accounting Double-Line Total Row */
        .total-row td {
          border-top: 1.5px solid #000 !important;
          border-bottom: 2.5px double #000 !important;
          font-weight: 700 !important;
          background-color: #fafafa !important;
          padding: 4px 6px !important;
        }
      `}</style>

      {/* Title & Subtitle */}
      <div className="text-center mb-1">
        <h2 className="text-lg font-bold uppercase tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      {/* Unified Single-Table T-Account Structure (guarantees row-to-row alignment) */}
      <table className="t-account-table">
        <thead>
          <tr>
            <th style={{ width: "35%", textAlign: "left" }} className="col-divider">
              {leftHeaderLabel}
            </th>
            <th style={{ width: "15%", textAlign: "right" }} className="center-t-divider">
              Amount (₹)
            </th>
            <th style={{ width: "35%", textAlign: "left" }} className="col-divider">
              {rightHeaderLabel}
            </th>
            <th style={{ width: "15%", textAlign: "right" }}>
              Amount (₹)
            </th>
          </tr>
        </thead>

        <tbody>
          {Array.from({ length: maxRows }).map((_, idx) => {
            const left = paddedLeft[idx];
            const right = paddedRight[idx];

            const leftBold = left && (left.emphasis === "bold" || left.emphasis === "total" || left.isHeader || left.isFooter);
            const rightBold = right && (right.emphasis === "bold" || right.emphasis === "total" || right.isHeader || right.isFooter);

            const leftIndent = left?.indent ?? (left?.isSubLedger ? 2 : left?.isCashBankSplit ? 3 : left?.isHeader ? 0 : 1);
            const rightIndent = right?.indent ?? (right?.isSubLedger ? 2 : right?.isCashBankSplit ? 3 : right?.isHeader ? 0 : 1);

            return (
              <tr key={idx}>
                {/* Left: Particulars */}
                <td
                  className="col-divider"
                  style={{
                    paddingLeft: left ? `${Math.max(6, leftIndent * 12)}px` : "6px",
                    fontWeight: leftBold ? 600 : 400,
                    color: left?.isCashBankSplit ? "#555" : "#000",
                    fontSize: left?.isCashBankSplit ? "8pt" : "8.5pt",
                    cursor: left?.onClick ? "pointer" : "default",
                  }}
                  onClick={left?.onClick}
                >
                  {left?.label ?? ""}
                </td>

                {/* Left: Amount */}
                <td
                  className="center-t-divider"
                  style={{
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontWeight: leftBold ? 600 : 400,
                    color: left?.isCashBankSplit ? "#555" : "#000",
                    fontSize: left?.isCashBankSplit ? "8pt" : "8.5pt",
                    whiteSpace: "nowrap",
                  }}
                >
                  {left?.amount ?? ""}
                </td>

                {/* Right: Particulars */}
                <td
                  className="col-divider"
                  style={{
                    paddingLeft: right ? `${Math.max(6, rightIndent * 12)}px` : "6px",
                    fontWeight: rightBold ? 600 : 400,
                    color: right?.isCashBankSplit ? "#555" : "#000",
                    fontSize: right?.isCashBankSplit ? "8pt" : "8.5pt",
                    cursor: right?.onClick ? "pointer" : "default",
                  }}
                  onClick={right?.onClick}
                >
                  {right?.label ?? ""}
                </td>

                {/* Right: Amount */}
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontWeight: rightBold ? 600 : 400,
                    color: right?.isCashBankSplit ? "#555" : "#000",
                    fontSize: right?.isCashBankSplit ? "8pt" : "8.5pt",
                    whiteSpace: "nowrap",
                  }}
                >
                  {right?.amount ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="total-row">
            <td className="col-divider" style={{ textAlign: "left", paddingLeft: "8px" }}>
              TOTAL
            </td>
            <td className="center-t-divider" style={{ textAlign: "right", fontFamily: "monospace" }}>
              {leftTotal}
            </td>
            <td className="col-divider" style={{ textAlign: "left", paddingLeft: "8px" }}>
              TOTAL
            </td>
            <td style={{ textAlign: "right", fontFamily: "monospace" }}>
              {rightTotal}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
