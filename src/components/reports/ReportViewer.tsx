import * as React from "react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/company-context";
import { PrintModeDialog, type PrintMode } from "./PrintModeDialog";
import { exportElementAsWord } from "@/lib/word-export";
import { fmtIndianDate } from "@/lib/format-date";
import { useI18n } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";
import { FitToWidth } from "./FitToWidth";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";
import { useShortcut } from "@/lib/keyboard";
import { toast } from "sonner";
import { recordFailure, recordStage } from "@/lib/crash-log";

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
  const { lang } = useI18n();
  const tt = React.useCallback((s: string) => tReportText(s, lang), [lang]);
  const company = companyName ?? activeMembership?.companies?.name ?? "";
  const city = companyCity ?? null;
  const gstin = companyGstin ?? activeMembership?.companies?.gstin ?? null;
  const fyStart = activeMembership?.companies?.financial_year_start ?? null;
  const fyText = React.useMemo(() => tt(formatFyRange(fyStart)), [fyStart, tt]);
  const fyShort = React.useMemo(() => formatFyShort(fyStart), [fyStart]);
  const periodText = asOf
    ? tt(`As on ${fmtIndianDate(asOf)}`)
    : fromDate && toDate
      ? tt(`For the period: ${fmtIndianDate(fromDate)} to ${fmtIndianDate(toDate)}`)
      : "";
  const addressLine = [city, gstin ? `GSTIN: ${gstin}` : null].filter(Boolean).join(" · ");

  const localizedTitle = tt(title);
  const localizedHeading = accountHeading ? tt(accountHeading) : "";

  const rootRef = React.useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const subtitleText = typeof subtitle === "string" ? tt(subtitle) : "";

  const doWord = React.useCallback(() => {
    if (onExportWord) {
      onExportWord();
      return;
    }
    if (!rootRef.current) return;
    const headerHtml = `
      <div class="report-print-header" style="text-align:center;margin-bottom:10pt">
        <div class="report-print-company-name" style="font-size:13pt;font-weight:700;text-transform:uppercase;letter-spacing:.5pt;color:#002060;margin-bottom:2pt">${escape(company)}</div>
        <div class="report-print-title" style="font-size:11pt;font-weight:600;margin-top:2pt;color:#000">${escape(localizedHeading || localizedTitle)}</div>
        ${fyShort ? `<div class="report-print-fy-line" style="font-size:10pt;font-weight:500;margin-top:1pt;color:#000">${escape(fyShort)}</div>` : ""}
        ${subtitleText ? `<div style="font-size:9pt;margin-top:1pt;color:#000">${escape(subtitleText)}</div>` : ""}
        ${periodText ? `<div style="font-size:9pt;margin-top:1pt;color:#000">${escape(periodText)}</div>` : ""}
        ${addressLine ? `<div style="font-size:8.5pt;color:#444;margin-top:1pt">${escape(addressLine)}</div>` : ""}
        <div class="report-header-rule" style="border-top:1pt solid #000;border-bottom:1pt solid #000;height:3pt;margin-top:4pt"></div>
      </div>`;
    const stem = (exportFileBase || title).replace(/[^A-Za-z0-9._-]+/g, "-");
    exportElementAsWord({
      element: rootRef.current,
      title: localizedTitle,
      fileName: `${stem}.doc`,
      headerHtml,
      orientation,
    });
  }, [onExportWord, company, localizedTitle, localizedHeading, subtitleText, periodText, addressLine, exportFileBase, orientation, title]);

  const handlePick = React.useCallback(
    (mode: PrintMode) => {
      setPickerOpen(false);
      // Allow the dialog to close before invoking blocking print/save APIs.
      window.setTimeout(() => {
        if (mode === "system") {
          window.print();
        } else if (mode === "pdf") {
          onExportPdf?.();
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, orientation, addressLine);

        } else if (mode === "word") {
          doWord();
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, orientation, addressLine);

        } else if (mode === "preview") {
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, orientation, addressLine);

        }
      }, 50);
    },
    [onExportPdf, doWord, company, localizedHeading, localizedTitle, fyShort, orientation],
  );

  const [pathname, setPathname] = React.useState(() =>
    typeof window === "undefined" ? "" : window.location.pathname,
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const shortcutsEnabled = !disablePrintShortcut && !isPrintPickerExcludedPath(pathname);

  useShortcut("Ctrl+p", (e) => { e.preventDefault(); setPickerOpen(true); },
    { scope: "global", allowInField: true, enabled: shortcutsEnabled, description: "Print / export report" });
  useShortcut("Meta+p", (e) => { e.preventDefault(); setPickerOpen(true); },
    { scope: "global", allowInField: true, enabled: shortcutsEnabled, description: "Print / export report" });

  useShortcut("p", (e) => { e.preventDefault(); handlePick("system"); },
    { scope: "dialog", enabled: pickerOpen && shortcutsEnabled, description: "System print" });
  useShortcut("d", (e) => { e.preventDefault(); handlePick("pdf"); },
    { scope: "dialog", enabled: pickerOpen && shortcutsEnabled, description: "PDF export" });
  useShortcut("w", (e) => { e.preventDefault(); handlePick("word"); },
    { scope: "dialog", enabled: pickerOpen && shortcutsEnabled, description: "Word export" });
  useShortcut("v", (e) => { e.preventDefault(); handlePick("preview"); },
    { scope: "dialog", enabled: pickerOpen && shortcutsEnabled, description: "Print preview" });

  React.useEffect(() => {
    const handler = () => openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, orientation, addressLine);
    window.addEventListener("report:preview", handler as EventListener);
    return () => window.removeEventListener("report:preview", handler as EventListener);
  }, [company, localizedHeading, localizedTitle, fyShort, orientation]);

  const [autoFit, setAutoFit] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("report.autoFit") !== "0";
  });
  React.useEffect(() => {
    try {
      window.localStorage.setItem("report.autoFit", autoFit ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [autoFit]);

  return (
    <div className={cn("report-print-root-wrap space-y-3", className)}>
      {(toolbar || true) && (
        <div className="flex items-start justify-between gap-2 print:hidden">
          <div className="min-w-0 flex-1">{toolbar}</div>
          <Button
            type="button"
            size="sm"
            variant={autoFit ? "default" : "outline"}
            className="shrink-0 gap-1.5"
            onClick={() => setAutoFit((v) => !v)}
            title={autoFit ? "Auto-fit: ON — report scales to fit screen" : "Auto-fit: OFF — report uses natural width"}
          >
            {autoFit ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="text-xs">Fit {autoFit ? "On" : "Off"}</span>
          </Button>
        </div>
      )}
      <div
        ref={rootRef}
        className={cn(
          "report-print-root",
          orientation === "landscape" && "report-print-landscape",
        )}
      >
        <div className="report-print-header mb-3 text-center">
          <div className="report-print-company-name text-lg font-bold uppercase tracking-wide leading-tight text-[#002060]">
            {company || "\u00A0"}
          </div>
          <div className="report-print-title text-sm font-semibold mt-0.5">
            {localizedHeading || localizedTitle}
          </div>
          {fyShort && (
            <div className="report-print-fy-line text-[12px] font-medium text-foreground mt-0.5">
              {fyShort}
            </div>
          )}
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {typeof subtitle === "string" ? subtitleText : subtitle}
            </div>
          )}
          {periodText && <div className="text-[11px] mt-0.5">{periodText}</div>}
          {addressLine && (
            <div className="text-[10px] text-muted-foreground mt-0.5">{addressLine}</div>
          )}
          <span className="report-print-company-capture hidden" aria-hidden>{company || "\u00A0"}</span>
          {fyShort && (
            <span className="report-print-fy-capture hidden" aria-hidden>{fyShort}</span>
          )}
          <div className="report-header-rule mt-2 w-full border-t border-b border-black h-[3px]" aria-hidden />
        </div>
        {autoFit ? (
          <FitToWidth className="print:!h-auto print:!overflow-visible">
            <div className="print:[transform:none!important] print:[width:100%!important]">
              {children}
            </div>
          </FitToWidth>
        ) : (
          children
        )}
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
 * Open a full-screen iframe containing the rendered report HTML.
 * Tauri's WebView blocks window.open() popups, so we inject an iframe
 * directly into the current document instead.
 */
function openPrintPreview(
  el: HTMLElement | null,
  company: string,
  heading: string,
  fyShort: string,
  orientation: "portrait" | "landscape",
  addressLine?: string,
): void {

  recordStage("preview", "start", {
    report: heading,
    node_found: !!el,
    orientation,
  });

  if (!el) {
    recordFailure("preview", new Error("Report root node not found — nothing to preview"), {
      stage: "start",
      report: heading,
    });
    return;
  }

  // Remove any existing preview iframe
  const existing = document.getElementById("report-preview-iframe");
  if (existing) existing.remove();

  const orient = orientation === "landscape" ? "landscape" : "portrait";

  // Clone the live DOM so late-rendered rows are captured.
  const clone = el.cloneNode(true) as HTMLElement;

  // Convert inputs to static text so their current values are preserved.
  clone.querySelectorAll("input, textarea, select").forEach((input: any) => {
    const val = input.value || "";
    const span = document.createElement("span");
    span.textContent = val;
    input.parentNode?.replaceChild(span, input);
  });

  recordStage("preview", "clone", {
    clone_html_len: clone.outerHTML.length,
    tables: clone.querySelectorAll("table").length,
    rows: clone.querySelectorAll("tr").length,
  });

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
    .preview-content { margin-top: 48px; position: relative; z-index: 1; }
    .preview-content {
      color: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: #fff !important;
    }
    .preview-content * {
      color: inherit !important;
      visibility: inherit !important;
      opacity: inherit !important;
    }
    .preview-content table,
    .preview-content tbody,
    .preview-content thead,
    .preview-content tfoot,
    .preview-content tr,
    .preview-content td,
    .preview-content th {
      display: revert !important;
      color: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .preview-content table {
      border-collapse: collapse !important;
      width: 100% !important;
    }
    .preview-content [style*="transform"] { transform: none !important; }
    .preview-content,
    .preview-content > div,
    .preview-content > div > div,
    .preview-content > div > div > div {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      width: auto !important;
      min-width: 0 !important;
    }
    .preview-content thead th,
    .preview-content .row-bold,
    .preview-content tfoot {
      background-color: #f0f0f0 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-print-header { text-align: center; margin-bottom: 10pt; }
    .report-print-header > div { margin: 1pt 0; }
    .report-print-company-name {
      font-size: 13pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5pt; color: #002060 !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .report-print-title { font-size: 11pt; font-weight: 600; margin-top: 2pt; }
    .report-print-fy-line { font-size: 10pt; font-weight: 500; margin-top: 1pt; }
    .report-header-rule { height: 3px; border-top: 1px solid #000;
      border-bottom: 1px solid #000; margin: 4pt 0 8pt; }
    .report-address-line { font-size: 8.5pt; color: #444; margin-top: 1pt; }

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
    [class*="print:hidden"] { display: none !important; }
    .overflow-hidden { overflow: visible !important; }
    @media print {
      .preview-bar { display: none !important; }
      body { padding: 0; }
      .preview-content { margin-top: 0; }
    }
  `;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escape(company)} — ${escape(heading)} — Preview</title>
<style>${css}</style>
</head>
<body>
<div class="preview-bar">
  <button onclick="window.print()">Print</button>
  <button onclick="window.parent.document.getElementById('report-preview-iframe').remove()">Close</button>
  <span style="margin-left:auto;color:#666">Print Preview</span>
</div>
<div class="preview-content report-print-root${orientation === "landscape" ? " report-print-landscape" : ""}">
  ${clone.outerHTML}
</div>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.id = "report-preview-iframe";
  iframe.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:9999;background:#fff;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    recordFailure("preview", new Error("iframe contentDocument is null"), { stage: "iframe" });
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  recordStage("preview", "iframe", {
    opened: true,
    html_len: html.length,
  });
}

/** Navigate to the Diagnostics page from a toast action. */
function openDiagnostics(): void {
  try {
    window.location.assign("/app/diagnostics");
  } catch {
    /* ignore */
  }
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
  const startStr = `${d}-${mo}-${y}`;
  const endStr = `31-03-${endY}`;
  const shortEnd = String(endY).slice(-2);
  return `FY ${y}-${shortEnd} (${startStr} to ${endStr})`;
}

/**
 * Extract just the "FY 2025-26" part for the primary report header.
 */
function formatFyShort(start: string | null | undefined): string {
  if (!start) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return "";
  const y = Number(m[1]);
  const endY = y + 1;
  const shortEnd = String(endY).slice(-2);
  return `Financial Year ${y}-${shortEnd}`;
}
