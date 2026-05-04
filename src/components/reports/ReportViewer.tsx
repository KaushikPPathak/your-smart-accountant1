import * as React from "react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/company-context";
import { PrintModeDialog, type PrintMode } from "./PrintModeDialog";
import { exportElementAsWord } from "@/lib/word-export";

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
  children,
}: ReportViewerProps) {
  const { activeMembership } = useCompany();
  const company = companyName ?? activeMembership?.companies?.name ?? "";
  const periodText = asOf
    ? `As on ${asOf}`
    : fromDate && toDate
      ? `From ${fromDate} to ${toDate}`
      : "";

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
        <div style="font-size:11pt;font-weight:600">${escape(title)}</div>
        ${subtitleText ? `<div style="font-size:9pt">${escape(subtitleText)}</div>` : ""}
        ${periodText ? `<div style="font-size:9pt">${escape(periodText)}</div>` : ""}
      </div>`;
    const stem = (exportFileBase || title).replace(/[^A-Za-z0-9._-]+/g, "-");
    exportElementAsWord({
      element: rootRef.current,
      title,
      fileName: `${stem}.doc`,
      headerHtml,
      orientation,
    });
  }, [onExportWord, company, title, subtitleText, periodText, exportFileBase, orientation]);

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
  }, [pickerOpen, handlePick]);

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
        <div className="report-print-header mb-3 border-b border-black pb-2 text-center">
          <div className="text-base font-bold uppercase tracking-wide">{company}</div>
          <div className="report-print-title text-sm font-semibold">{title}</div>
          {subtitle && <div className="text-xs">{subtitle}</div>}
          {periodText && <div className="text-[11px]">{periodText}</div>}
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
