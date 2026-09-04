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
import { recordFailure, recordStage } from "@/lib/crash-log";

const PRINT_PICKER_EXCLUDED = [
  "/app/reports/gst",
  "/app/reports/gstr1",
  "/app/reports/gstr3b",
  "/app/reports/gstr2b",
];

function isPrintPickerExcludedPath(pathname: string): boolean {
  return PRINT_PICKER_EXCLUDED.some((p) => pathname.startsWith(p));
}

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
  onExportPdf?: () => void;
  onExportWord?: () => void;
  exportFileBase?: string;
  disablePrintShortcut?: boolean;
  accountHeading?: string;
  companyCity?: string | null;
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
  orientation,
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

  // Auto-detect landscape for dual-column T-Accounts (P&L, Trading, Balance Sheet)
  const isTReport =
    title.toLowerCase().includes("profit") ||
    title.toLowerCase().includes("trading") ||
    title.toLowerCase().includes("income & expenditure") ||
    title.toLowerCase().includes("balance sheet");

  const effectiveOrientation: "portrait" | "landscape" =
    orientation ?? (isTReport ? "landscape" : "portrait");

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
      orientation: effectiveOrientation,
    });
  }, [onExportWord, company, localizedTitle, localizedHeading, subtitleText, periodText, addressLine, exportFileBase, effectiveOrientation, title]);

  const handlePick = React.useCallback(
    (mode: PrintMode) => {
      setPickerOpen(false);
      window.setTimeout(() => {
        if (mode === "system") {
          openPrintPreview(
            rootRef.current,
            company,
            localizedHeading || localizedTitle,
            fyShort,
            effectiveOrientation,
            true,
          );
        } else if (mode === "pdf") {
          onExportPdf?.();
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, effectiveOrientation);
        } else if (mode === "word") {
          doWord();
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, effectiveOrientation);
        } else if (mode === "preview") {
          openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, effectiveOrientation);
        }
      }, 50);
    },
    [onExportPdf, doWord, company, localizedHeading, localizedTitle, fyShort, effectiveOrientation],
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
    const handler = () => openPrintPreview(rootRef.current, company, localizedHeading || localizedTitle, fyShort, effectiveOrientation);
    window.addEventListener("report:preview", handler as EventListener);
    return () => window.removeEventListener("report:preview", handler as EventListener);
  }, [company, localizedHeading, localizedTitle, fyShort, effectiveOrientation]);

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
          effectiveOrientation === "landscape" && "report-print-landscape",
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

function openPrintPreview(
  el: HTMLElement | null,
  company: string,
  heading: string,
  fyShort: string,
  orientation: "portrait" | "landscape",
  autoPrint = false,
): void {
  const startTs = Date.now();
  recordStage("preview", "start", {
    report: heading,
    node_found: !!el,
    orientation,
    ts: startTs,
  });

  if (!el) {
    recordFailure("preview", new Error("Report root node not found — nothing to preview"), {
      stage: "start",
      report: heading,
      ts: startTs,
    });
    return;
  }

  const existing = document.getElementById("report-preview-iframe");
  if (existing) existing.remove();

  const orient = orientation === "landscape" ? "landscape" : "portrait";

  const clone = el.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("input, textarea, select").forEach((input: any) => {
    const val = input.value || "";
    const span = document.createElement("span");
    span.textContent = val;
    input.parentNode?.replaceChild(span, input);
  });

  // Remove screen-only elements from preview clone
  clone.querySelectorAll(".print\\:hidden, [class*='print:hidden']").forEach((node) => node.remove());

  recordStage("preview", "clone", {
    clone_html_len: clone.outerHTML.length,
    tables: clone.querySelectorAll("table").length,
    rows: clone.querySelectorAll("tr").length,
  });

  const css = `
    @page { size: A4 ${orient}; margin: 8mm 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000;
      font: 9pt/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { padding: 8mm 10mm; }
    .preview-bar { position: fixed; top: 0; left: 0; right: 0; display: flex;
      gap: 8px; padding: 8px 12px; background: #f5f5f5;
      border-bottom: 1px solid #ddd; font: 13px system-ui; z-index: 10; }
    .preview-bar button { padding: 6px 12px; border: 1px solid #888;
      background: #fff; border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600; }
    .preview-content { margin-top: 48px; position: relative; z-index: 1; }
    .preview-content, .preview-content * {
      color: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* CRITICAL T-ACCOUNT SIDE-BY-SIDE DUAL COLUMN RULES */
    .grid-cols-2,
    .t-account-grid,
    .t-account-print-wrapper,
    [class*="grid-cols-2"] {
      display: flex !important;
      flex-direction: row !important;
      width: 100% !important;
      gap: 12px !important;
      align-items: flex-start !important;
    }

    .grid-cols-2 > div,
    .t-account-grid > div,
    .t-account-print-wrapper > div,
    .t-account-side,
    .t-account-print-col {
      flex: 1 1 50% !important;
      width: 50% !important;
      max-width: 50% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }

    .grid-cols-2 > div:first-child,
    .t-account-grid > div:first-child,
    .t-account-print-wrapper > div:first-child {
      border-right: 1.5pt solid #000 !important;
      padding-right: 8px !important;
    }

    .grid-cols-2 > div:last-child,
    .t-account-grid > div:last-child,
    .t-account-print-wrapper > div:last-child {
      padding-left: 8px !important;
    }

    /* TABLE FORMATTING */
    table {
      width: 100% !important;
      border-collapse: collapse !important;
      font-size: 8.5pt !important;
    }
    th, td {
      border: 0.5pt solid #bbb;
      padding: 2.5pt 4pt;
      vertical-align: top;
      text-align: left;
    }
    th {
      background: #f0f0f0 !important;
      font-weight: 700;
    }
    tfoot td, tfoot th {
      border-top: 1.5pt solid #000 !important;
      border-bottom: 2pt double #000 !important;
      font-weight: 700;
      background: #fafafa !important;
    }

    .report-print-header { text-align: center; margin-bottom: 8pt; }
    .report-print-company-name {
      font-size: 13pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5pt; color: #002060 !important;
    }
    .report-print-title { font-size: 11pt; font-weight: 600; margin-top: 2pt; }
    .report-print-fy-line { font-size: 9pt; font-weight: 500; margin-top: 1pt; }
    .report-header-rule { height: 2px; border-top: 1px solid #000;
      border-bottom: 1px solid #000; margin: 3pt 0 6pt; }

    .print\\:hidden, [class*="print:hidden"] { display: none !important; }
    .hidden { display: none !important; }
    .print\\:block { display: block !important; }

    @media print {
      .preview-bar { display: none !important; }
      body { padding: 0 !important; margin: 0 !important; }
      .preview-content { margin-top: 0 !important; }
      .run-head, .run-foot {
        display: flex; position: fixed; left: 0; right: 0;
        gap: 8pt; justify-content: space-between; align-items: baseline;
        font-size: 8pt; color: #000;
      }
      .run-head { top: 0; font-weight: 700; border-bottom: 0.5pt solid #000; padding-bottom: 2pt; }
      .run-foot { bottom: 0; color: #444; border-top: 0.5pt solid #999; padding-top: 2pt; }
      .preview-content { padding: 6mm 0 4mm; }
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
  <button id="preview-print-btn" disabled onclick="window.print()">Print</button>
  <button onclick="window.parent.document.getElementById('report-preview-iframe').remove()">Close</button>
  <span style="margin-left:auto;color:#666">Print Preview</span>
</div>
<div class="run-head"><span>${escape(company)}</span><span>${escape(fyShort)}</span></div>
<div class="run-foot"><span>${escape(heading)}</span><span>${escape(new Date().toLocaleDateString("en-IN"))}</span></div>

<div class="preview-content report-print-root${orient === "landscape" ? " report-print-landscape" : ""}">
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

  const ready = (async () => {
    try {
      const idoc = iframe.contentDocument;
      if (!idoc) return;
      await (idoc as Document & { fonts?: FontFaceSet }).fonts?.ready?.catch?.(() => undefined);
      await Promise.all(
        Array.from(idoc.images).map((img) =>
          img.complete ? Promise.resolve() : img.decode().catch(() => undefined),
        ),
      );
    } catch {
      /* best effort */
    }
  })();

  void ready.then(() => {
    const btn = iframe.contentDocument?.getElementById("preview-print-btn") as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
    if (autoPrint) {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* ignore */
      }
    }
  });

  recordStage("preview", "iframe", {
    opened: true,
    html_len: html.length,
    auto_print: autoPrint,
    elapsed_ms: Date.now() - startTs,
  });
}

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

function formatFyShort(start: string | null | undefined): string {
  if (!start) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return "";
  const y = Number(m[1]);
  const endY = y + 1;
  const shortEnd = String(endY).slice(-2);
  return `Financial Year ${y}-${shortEnd}`;
}
