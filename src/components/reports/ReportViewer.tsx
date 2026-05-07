import * as React from "react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/company-context";
import { PrintModeDialog, type PrintMode } from "./PrintModeDialog";
import { exportElementAsWord } from "@/lib/word-export";

/**
 * Routes excluded from the universal Ctrl+P picker. GST reports (GSTR-1,
 * GSTR-3B, GSTR-2B recon, GST sales/purchase books) follow the official
 * GSTN print/export flow and must not be intercepted.
 */
const PRINT_PICKER_EXCLUDED = [
  "/app/reports/gst",       // covers gst-sales-book, gst-purchase-book
  "/app/reports/gstr1",
  "/app/reports/gstr3b",
  "/app/reports/gstr2b",
];

function isPrintPickerExcludedPath(pathname: string): boolean {
  return PRINT_PICKER_EXCLUDED.some((p) => pathname.startsWith(p));
}

/**
 * ReportViewer — print-ready wrapper for any report.
 *
 * Behavior
 * - On screen: renders children with an optional toolbar slot above.
 * - On print: hides app chrome via CSS in `src/styles.css`, prints a header
 *   with Company / Title / Subtitle / Period on every page.
 * - Ctrl+P (or Cmd+P) anywhere on the page opens a "Print mode" picker:
 *     1) System Printer  → window.print()
 *     2) PDF             → calls onExportPdf
 *     3) Word (.doc)     → exports the rendered report HTML as .doc
 *   Inside the picker, P / D / W select directly.
 */
export interface ReportViewerProps {
  title: string;
  subtitle?: React.ReactNode;
  fromDate?: string;
  toDate?: string;
  asOf?: string;
  toolbar?: React.ReactNode;
  companyName?: string;
  orientation?: "portrait" | "landscape";
  className?: string;
  /** PDF export hook — usually wired to downloadPdfTable(). */
  onExportPdf?: () => void;
  /**
   * Optional Word override. If omitted, the picker exports the rendered
   * report HTML as a .doc file (editable in Word).
   */
  onExportWord?: () => void;
  /** File-name stem used by the default Word export. Defaults to title. */
  exportFileBase?: string;
  /**
   * Opt out of the universal Ctrl+P picker (e.g. GST returns where the
   * statutory print/export flow must be used instead). When true, Ctrl+P
   * falls back to the browser's native print dialog.
   */
  disablePrintShortcut?: boolean;
  /**
   * Pre-formatted account / ledger heading line, e.g.
   *   "Ledger Account: ACME Traders"
   *   "Cash Book"
   *   "Bank Book: HDFC Current 0123"
   * Renders directly under the title on every printed page.
   */
  accountHeading?: string;
  /** Company city (printed on the small address/GST line). */
  companyCity?: string | null;
  /** Company GSTIN (printed on the small address/GST line). */
  companyGstin?: string | null;
  children: React.ReactNode;
}

export function ReportViewer({
  title,
  subtitle,
  fromDate,
  toDate,
  asOf,
  toolbar,
  companyName,
  orientation = "portrait",
  className,
  onExportPdf,
  onExportWord,
  exportFileBase,
  disablePrintShortcut,
  accountHeading,
  companyCity,
  companyGstin,
  children,
}: ReportViewerProps) {
  const { activeMembership } = useCompany();
  const company = companyName ?? activeMembership?.companies?.name ?? "";
  const city = companyCity ?? null;
  const gstin = companyGstin ?? activeMembership?.companies?.gstin ?? null;
  const fyStart = activeMembership?.companies?.financial_year_start ?? null;
  const fyText = React.useMemo(() => formatFyRange(fyStart), [fyStart]);
  const periodText = asOf
    ? `As on ${asOf}`
    : fromDate && toDate
      ? `For the period: ${fromDate} to ${toDate}`
      : "";
  const addressLine = [city, gstin ? `GSTIN: ${gstin}` : null].filter(Boolean).join(" · ");

  const rootRef = React.useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const subtitleText = typeof subtitle === "string" ? subtitle : "";

  const doWord = React.useCallback(() => {
    if (onExportWord) {
      onExportWord();
      return;
    }
    if (!rootRef.current) return;
    const headerHtml = `
      <div class="report-print-header">
        <div style="font-size:13pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5pt">${escape(company)}</div>
        <div style="font-size:11pt;font-weight:600">${escape(accountHeading || title)}</div>
        ${subtitleText ? `<div style="font-size:9pt">${escape(subtitleText)}</div>` : ""}
        ${periodText ? `<div style="font-size:9pt">${escape(periodText)}</div>` : ""}
        ${addressLine ? `<div style="font-size:8.5pt;color:#444">${escape(addressLine)}</div>` : ""}
        <div style="border-top:1pt solid #000;border-bottom:1pt solid #000;height:3pt;margin-top:4pt"></div>
      </div>`;
    const stem = (exportFileBase || title).replace(/[^A-Za-z0-9._-]+/g, "-");
    exportElementAsWord({
      element: rootRef.current,
      title,
      fileName: `${stem}.doc`,
      headerHtml,
      orientation,
    });
  }, [onExportWord, company, title, accountHeading, subtitleText, periodText, addressLine, exportFileBase, orientation]);

  const handlePick = React.useCallback(
    (mode: PrintMode) => {
      setPickerOpen(false);
      // Allow the dialog to close before invoking blocking print/save APIs.
      window.setTimeout(() => {
        if (mode === "system") window.print();
        else if (mode === "pdf") onExportPdf?.();
        else if (mode === "word") doWord();
      }, 50);
    },
    [onExportPdf, doWord],
  );

  // Global Ctrl+P / Cmd+P → open picker. While picker is open, P/D/W pick.
  React.useEffect(() => {
    // Honour explicit opt-out and the GST-route exception list. In both
    // cases we leave Ctrl+P alone so the browser's native dialog runs.
    if (disablePrintShortcut) return;
    if (typeof window !== "undefined" && isPrintPickerExcludedPath(window.location.pathname)) return;
    const onKey = (e: KeyboardEvent) => {
      // Open picker
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPickerOpen(true);
        return;
      }
      // Quick keys while open
      if (!pickerOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "p") { e.preventDefault(); handlePick("system"); }
      else if (k === "d") { e.preventDefault(); handlePick("pdf"); }
      else if (k === "w") { e.preventDefault(); handlePick("word"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, handlePick, disablePrintShortcut]);

  return (
    <div className={cn("report-print-root-wrap space-y-3", className)}>
      {toolbar && <div className="print:hidden">{toolbar}</div>}
      <div
        ref={rootRef}
        className={cn(
          "report-print-root",
          orientation === "landscape" && "report-print-landscape",
        )}
      >
        <div className="report-print-header mb-3 text-center">
          <div className="text-lg font-bold uppercase tracking-wide leading-tight">{company || "\u00A0"}</div>
          {/* Hidden running-header capture spans — fed into @page margin
             boxes via `string-set` so every printed page repeats the
             company/proprietor name and financial year. */}
          <span className="report-print-company-capture" aria-hidden>{company || "\u00A0"}</span>
          {fyText && (
            <span className="report-print-fy-capture" aria-hidden>{fyText}</span>
          )}
          <div className="report-print-title text-sm font-semibold mt-0.5">
            {accountHeading || title}
          </div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          {periodText && <div className="text-[11px]">{periodText}</div>}
          {fyText && <div className="text-[10px] text-muted-foreground">{fyText}</div>}
          {addressLine && (
            <div className="text-[10px] text-muted-foreground">{addressLine}</div>
          )}
          <div className="report-header-rule mt-2" aria-hidden />
        </div>
        {children}
      </div>
      <PrintModeDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handlePick}
        hasPdf={!!onExportPdf}
        hasWord
      />
    </div>
  );
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Format the company's financial year start (YYYY-MM-DD, typically
 * 04-01) into a human label that covers a printable page header.
 * Example: "2025-04-01" -> "FY 2025-26 (01/04/2025 to 31/03/2026)".
 */
function formatFyRange(start: string | null | undefined): string {
  if (!start) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = m[2];
  const d = m[3];
  const endY = y + 1;
  // Indian FY: 1 Apr YYYY to 31 Mar YYYY+1
  const startStr = `${d}/${mo}/${y}`;
  const endStr = `31/03/${endY}`;
  const shortEnd = String(endY).slice(-2);
  return `FY ${y}-${shortEnd} (${startStr} to ${endStr})`;
}
