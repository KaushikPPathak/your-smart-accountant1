import * as React from "react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/company-context";
import { PrintModeDialog, type PrintMode } from "./PrintModeDialog";
import { exportElementAsWord } from "@/lib/word-export";
import { fmtIndianDate } from "@/lib/format-date";

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
    ? `As on ${fmtIndianDate(asOf)}`
    : fromDate && toDate
      ? `For the period: ${fmtIndianDate(fromDate)} to ${fmtIndianDate(toDate)}`
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
        else if (mode === "preview") openPrintPreview(rootRef.current, company, accountHeading || title, orientation);
      }, 50);
    },
    [onExportPdf, doWord, company, accountHeading, title, orientation],
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
      else if (k === "v") { e.preventDefault(); handlePick("preview"); }
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
 * Open a new window containing the rendered report HTML with the same
 * stylesheets so the user can preview the print layout before sending it
 * to the printer / PDF / Word. The window auto-invokes window.print()
 * once content is ready; the user can cancel and just inspect.
 */
function openPrintPreview(
  el: HTMLElement | null,
  company: string,
  heading: string,
  orientation: "portrait" | "landscape",
): void {
  if (!el) return;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  const orient = orientation === "landscape" ? "landscape" : "portrait";
  // Pull every stylesheet (Tailwind, design-tokens, component CSS) from the
  // host document so utility classes (bg-card, text-muted-foreground,
  // overflow-hidden, etc.) used inside report children resolve in the popup.
  // Without this, complex children (Cards, tables wrapped in tokenised
  // containers) can render with white-on-white text or zero-height boxes.
  const inheritedStyles = Array.from(
    document.head.querySelectorAll('link[rel="stylesheet"], style'),
  )
    .map((n) => n.outerHTML)
    .join("\n");
  const innerHtml = el.innerHTML?.trim() || "";
  const body = innerHtml
    ? `<div class="preview-content report-print-root${orientation === "landscape" ? " report-print-landscape" : ""}">${innerHtml}</div>`
    : `<div class="preview-content"><p style="padding:24pt;text-align:center;color:#666">Nothing to preview yet — the report has no rendered content.</p></div>`;
  // Self-contained CSS so the preview window does not depend on Vite-injected
  // stylesheets from the parent document (which often fail to load cross-window
  // and leave the preview blank).
  const css = `
    @page { size: A4 ${orient}; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000;
      font: 10pt/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { padding: 14mm; }
    .preview-bar { position: fixed; top: 0; left: 0; right: 0; display: flex;
      gap: 8px; padding: 8px 12px; background: #f5f5f5;
      border-bottom: 1px solid #ddd; font: 13px system-ui; z-index: 10; }
    .preview-bar button { padding: 6px 12px; border: 1px solid #888;
      background: #fff; border-radius: 4px; cursor: pointer; font: inherit; }
    .preview-content { margin-top: 48px; }
    /* Force readable colours regardless of design-token resolution in popup. */
    .preview-content, .preview-content * { color: #000 !important;
      background-color: transparent !important; border-color: #000 !important; }
    .preview-content thead th, .preview-content .row-bold,
    .preview-content tfoot { background-color: #f0f0f0 !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-print-header { text-align: center; margin-bottom: 10pt; }
    .report-print-header > div { margin: 1pt 0; }
    .report-print-header .text-lg,
    .report-print-header div:first-child {
      font-size: 13pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5pt; }
    .report-print-title { font-size: 11pt; font-weight: 600; }
    .report-print-company-capture, .report-print-fy-capture { display: none; }
    .report-header-rule { height: 3px; border-top: 1px solid #000;
      border-bottom: 1px solid #000; margin: 4pt 0 8pt; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th, td { border: 0.5pt solid #000; padding: 3pt 4pt; vertical-align: top;
      text-align: left; }
    th { background: #f0f0f0; font-weight: 600;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td.num, th.num, .num { text-align: right; font-variant-numeric: tabular-nums;
      white-space: nowrap; }
    .row-bold td, .row-bold th, tfoot td, tfoot th { font-weight: 700;
      background: #f7f7f7; }
    .narration-cell { white-space: normal; word-break: break-word; }
    /* Strip on-screen-only chrome that lives inside the report root. */
    [class*="print:hidden"] { display: none !important; }
    /* Some report cards use overflow:hidden which can clip the table when
       the popup is narrower than the rendered landscape width. */
    .preview-content .overflow-hidden { overflow: visible !important; }
    @media print {
      .preview-bar { display: none !important; }
      body { padding: 0; }
      .preview-content { margin-top: 0; }
    }
  `;
  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${escape(company)} — ${escape(heading)} — Preview</title>` +
      inheritedStyles +
      `<style>${css}</style></head><body>` +
      `<div class="preview-bar">` +
        `<button onclick="window.print()">Print</button>` +
        `<button onclick="window.close()">Close</button>` +
        `<span style="margin-left:auto;color:#666">Print Preview</span>` +
      `</div>` +
      body +
      `</body></html>`,
  );
  w.document.close();
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
  const startStr = `${d}-${mo}-${y}`;
  const endStr = `31-03-${endY}`;
  const shortEnd = String(endY).slice(-2);
  return `FY ${y}-${shortEnd} (${startStr} to ${endStr})`;
}
