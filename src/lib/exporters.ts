// Shared exporters: PDF (jsPDF + autotable) and Excel (SheetJS).
// Files are routed through the desktop saver — in the .exe they land in
// Documents/YourMehtaji/Exports/<Company>/<subFolder>/ and auto-open;
// in the browser they fall back to a normal download.
//
// IMPORTANT: jspdf / jspdf-autotable / xlsx are HEAVY (~600 KB combined).
// They are loaded dynamically inside the export functions so the initial
// app bundle stays small. This file is statically imported by many report
// routes; keep the top-level imports type-only.
import type jsPDFType from "jspdf";
import type autoTableType from "jspdf-autotable";
import type * as XLSXType from "xlsx";
import { saveExport } from "./desktop-save";
import { getStoredLang } from "@/lib/i18n";
import { prepareReportFont } from "@/lib/pdf-fonts";
import { tReportLabel } from "@/lib/report-i18n";
import { tReportText } from "@/lib/report-i18n-rules";
import { promoteRows } from "@/lib/export-format";

// Re-export the XLSX namespace as a type alias usable both as type and namespace.
// eslint-disable-next-line @typescript-eslint/no-namespace
type XLSX = typeof XLSXType;

async function loadJsPdf(): Promise<{ jsPDF: typeof jsPDFType; autoTable: typeof autoTableType }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

async function loadXlsx(): Promise<typeof XLSXType> {
  return await import("xlsx");
}




function localizeExportText(text: string, lang = getStoredLang()): string {
  if (!text) return text;
  return tReportText(text, lang);
}

function localizeExportRows<T>(rows: T[][], lang = getStoredLang()): T[][] {
  return rows.map((row) =>
    row.map((cell) => (typeof cell === "string" ? (localizeExportText(cell, lang) as T) : cell)),
  );
}

export interface PdfTableOptions {
  title: string;
  subtitle?: string;
  /** Company / proprietor name printed bold above the report title on every page. */
  companyName?: string;
  /** Optional secondary line under the company name (e.g. FY label, GSTIN). */
  companySubLine?: string;
  head: string[][];
  body: (string | number)[][];
  foot?: (string | number)[][];
  fileName: string;
  orientation?: "p" | "l";
  rightAlignCols?: number[]; // column indexes that should be right aligned (numeric)
  /** Folder under the company export root. Defaults to "Reports". */
  subFolder?: string;
  /** Draw a thick vertical divider on the LEFT edge of this column (e.g. T-shape ledger center). */
  dividerBeforeCol?: number;
}

export function downloadPdfTable(opts: PdfTableOptions): void {
  void (async () => {
    const lang = getStoredLang();
    const { jsPDF, autoTable } = await loadJsPdf();
    const doc = new jsPDF({ orientation: opts.orientation || "p", unit: "pt", format: "a4" });
    const FONT = await prepareReportFont(doc, lang);
    const pageW = doc.internal.pageSize.getWidth();


    const title = localizeExportText(opts.title, lang);
    const subtitle = opts.subtitle ? localizeExportText(opts.subtitle, lang) : undefined;
    const head = localizeExportRows(opts.head, lang);
    const body = localizeExportRows(opts.body as (string | number)[][], lang);
    const foot = opts.foot ? localizeExportRows(opts.foot as (string | number)[][], lang) : undefined;

    let y = 28;
    if (opts.companyName) {
      doc.setFont(FONT, "bold");
      doc.setFontSize(13);
      doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
      y += 14;
    }
    if (opts.companySubLine) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(9);
      doc.text(opts.companySubLine, pageW / 2, y, { align: "center" });
      y += 12;
    }
    doc.setFont(FONT, "bold");
    doc.setFontSize(12);
    doc.text(title, pageW / 2, y, { align: "center" });
    y += 14;
    if (subtitle) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(10);
      doc.text(subtitle, pageW / 2, y, { align: "center" });
      y += 12;
    }
    const tableStartY = y + 4;

    const columnStyles: Record<number, { halign: "right" }> = {};
    (opts.rightAlignCols || []).forEach((c) => (columnStyles[c] = { halign: "right" }));

    autoTable(doc, {
      startY: tableStartY,
      head,
      body,
      foot,
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: FONT, fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5 },
      headStyles: { font: FONT, fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.5 },
      footStyles: { font: FONT, fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.8 },
        columnStyles,
        margin: { top: tableStartY },
        didParseCell: (data) => {
          data.cell.styles.font = FONT;
        },
        didDrawCell: (data) => {
          if (opts.dividerBeforeCol != null && data.column.index === opts.dividerBeforeCol) {
            doc.setLineWidth(1.6);
            doc.setDrawColor(0, 0, 0);
            doc.line(data.cell.x, data.cell.y, data.cell.x, data.cell.y + data.cell.height);
            doc.setLineWidth(0.5);
          }
        },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          let hy = 28;
          if (opts.companyName) {
            doc.setFont(FONT, "bold");
            doc.setFontSize(13);
            doc.text(opts.companyName.toUpperCase(), pageW / 2, hy, { align: "center" });
            hy += 14;
          }
          if (opts.companySubLine) {
            doc.setFont(FONT, "normal");
            doc.setFontSize(9);
            doc.text(opts.companySubLine, pageW / 2, hy, { align: "center" });
            hy += 12;
          }
          doc.setFont(FONT, "bold");
          doc.setFontSize(12);
          doc.text(title, pageW / 2, hy, { align: "center" });
          if (subtitle) {
            hy += 14;
            doc.setFont(FONT, "normal");
            doc.setFontSize(10);
            doc.text(subtitle, pageW / 2, hy, { align: "center" });
          }
        }
        const pageW2 = doc.internal.pageSize.getWidth();
        const pageLabel = tReportLabel("Page", lang);
        const ofLabel = tReportLabel("of", lang);
        const str = `${pageLabel} ${doc.getNumberOfPages()} ${ofLabel} {total_pages_count_string}`;
        doc.setFont(FONT, "normal");
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(str, pageW2 / 2, doc.internal.pageSize.getHeight() - 12, { align: "center" });
        doc.setTextColor(0);
      },
    });
    if (typeof (doc as unknown as { putTotalPages?: (s: string) => void }).putTotalPages === "function") {
      (doc as unknown as { putTotalPages: (s: string) => void }).putTotalPages("{total_pages_count_string}");
    }

    const buf = doc.output("arraybuffer");
    await saveExport({
      subFolder: opts.subFolder || "Reports",
      fileName: opts.fileName,
      contents: buf,
      mime: "application/pdf",
    });
  })();
}

export type XlsxCell = string | number | XLSXType.CellObject;
export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][]; // first row may be header
  /** 0-based row index of the header row to attach an auto-filter to.
   *  Defaults to 0 (first row). Set to null to skip auto-filter for this sheet. */
  autoFilterHeaderRow?: number | null;
  /** Optional styled-header mode. "gstn" mimics the GST Offline-Tool look —
   *  bold merged title row, bold GSTIN/FP row, blue header with white bold text,
   *  freeze pane below the header. */
  styling?: "gstn";
}

// Try to load xlsx-js-style (a drop-in fork of xlsx that preserves cell styles
// on write). Falls back to the plain xlsx package if unavailable.
async function loadXlsxWithStyles(): Promise<typeof XLSXType> {
  try {
    const mod = (await import("xlsx-js-style")) as unknown as { default?: typeof XLSXType } & typeof XLSXType;
    return (mod.default ?? mod) as typeof XLSXType;
  } catch {
    return await loadXlsx();
  }
}

export function downloadXlsx(fileName: string, sheets: XlsxSheet[], subFolder = "Reports"): void {
  void (async () => {
    const lang = getStoredLang();
    const anyStyled = sheets.some((s) => s.styling);

    // Pre-process cells (i18n + money/date promotion) on the main thread —
    // this is cheap. Heavy SheetJS work runs in a worker so large ledger
    // exports don't freeze the UI.
    const prepared: XlsxSheet[] = sheets.map((s) => {
      const localized: XlsxCell[][] = s.rows.map((row) =>
        row.map((cell) =>
          typeof cell === "string" ? (localizeExportText(cell, lang) as XlsxCell) : cell,
        ),
      );
      const promoted = promoteRows(localized as unknown[][]) as XlsxCell[][];
      return {
        name: localizeExportText(s.name, lang),
        rows: promoted,
        autoFilterHeaderRow: s.autoFilterHeaderRow,
        styling: s.styling,
      };
    });

    const totalRows = prepared.reduce((n, s) => n + s.rows.length, 0);
    const { showExportProgress } = await import("@/lib/export-progress");
    const progress = showExportProgress(fileName, totalRows);

    const runInWorker = async (): Promise<ArrayBuffer> =>
      await new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/xlsx-export.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (ev: MessageEvent<{
          type: "progress" | "done" | "error";
          buffer?: ArrayBuffer; message?: string;
          rowsDone?: number; rowsTotal?: number; stage?: string;
        }>) => {
          const msg = ev.data;
          if (msg.type === "progress") {
            progress.update(msg.rowsDone ?? 0, msg.stage);
          } else if (msg.type === "done" && msg.buffer) {
            worker.terminate();
            resolve(msg.buffer);
          } else if (msg.type === "error") {
            worker.terminate();
            reject(new Error(msg.message ?? "Worker failed"));
          }
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(e.error ?? new Error(e.message || "Worker crashed"));
        };
        worker.postMessage({ sheets: prepared, anyStyled });
      });

    let buf: ArrayBuffer;
    try {
      buf = await runInWorker();
    } catch (err) {
      // Fallback: run on main thread. Keeps exports working if workers are
      // blocked (rare — some corporate setups strip module workers).
      console.warn("[exporters] worker fallback:", err);
      const XLSX = anyStyled ? await loadXlsxWithStyles() : await loadXlsx();
      const wb = XLSX.utils.book_new();
      for (const s of prepared) {
        const ws = XLSX.utils.aoa_to_sheet(s.rows as unknown[][]);
        XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
      }
      buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: anyStyled, compression: true }) as ArrayBuffer;
    }

    progress.done();
    await saveExport({
      subFolder,
      fileName,
      contents: buf,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  })();
}




// Convenience: paise → rupees number for sheets
export const r = (paise: number): number => Number((paise / 100).toFixed(2));

export interface PdfSection {
  /** Section heading printed bold above this section's table. */
  sectionTitle: string;
  /** Optional secondary line under the section title. */
  sectionSubtitle?: string;
  head: (string | object)[][];
  body: (string | number)[][];
  foot?: (string | number)[][];
  rightAlignCols?: number[];
  /** Draw a thick vertical divider before this column index (T-format split). */
  dividerBeforeCol?: number;
}

export interface PdfMultiTableOptions {
  /** Document-level title repeated as the page header on every page. */
  title: string;
  subtitle?: string;
  companyName?: string;
  companySubLine?: string;
  fileName: string;
  orientation?: "p" | "l";
  /** Folder under the company export root. Defaults to "Reports". */
  subFolder?: string;
  sections: PdfSection[];
}

/** Renders multiple report sections (e.g. one per ledger) into a single PDF.
 *  Every section starts on a fresh page and reuses the same company header. */
export function downloadPdfMultiTable(opts: PdfMultiTableOptions): void {
  void (async () => {
    const lang = getStoredLang();
    const { jsPDF, autoTable } = await loadJsPdf();
    const doc = new jsPDF({ orientation: opts.orientation || "p", unit: "pt", format: "a4" });
    const FONT = await prepareReportFont(doc, lang);
    const pageW = doc.internal.pageSize.getWidth();


    const title = localizeExportText(opts.title, lang);
    const subtitle = opts.subtitle ? localizeExportText(opts.subtitle, lang) : undefined;

    const drawPageHeader = (): number => {
      let y = 28;
      if (opts.companyName) {
        doc.setFont(FONT, "bold");
        doc.setFontSize(13);
        doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
        y += 14;
      }
      if (opts.companySubLine) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(9);
        doc.text(opts.companySubLine, pageW / 2, y, { align: "center" });
        y += 12;
      }
      doc.setFont(FONT, "bold");
      doc.setFontSize(12);
      doc.text(title, pageW / 2, y, { align: "center" });
      y += 14;
      if (subtitle) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(10);
        doc.text(subtitle, pageW / 2, y, { align: "center" });
        y += 12;
      }
      return y + 4;
    };

    opts.sections.forEach((section, idx) => {
      if (idx > 0) doc.addPage();
      let y = drawPageHeader();
      doc.setFont(FONT, "bold");
      doc.setFontSize(11);
      doc.text(localizeExportText(section.sectionTitle, lang), pageW / 2, y, { align: "center" });
      y += 13;
      if (section.sectionSubtitle) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(9);
        doc.text(localizeExportText(section.sectionSubtitle, lang), pageW / 2, y, { align: "center" });
        y += 11;
      }
      const columnStyles: Record<number, { halign: "right" }> = {};
      (section.rightAlignCols || []).forEach((c) => (columnStyles[c] = { halign: "right" }));
      autoTable(doc, {
        startY: y + 4,
        head: localizeExportRows(section.head, lang),
        body: localizeExportRows(section.body as (string | number)[][], lang),
        foot: section.foot ? localizeExportRows(section.foot as (string | number)[][], lang) : undefined,
        showFoot: "lastPage",
        theme: "grid",
        styles: { font: FONT, fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5 },
        headStyles: { font: FONT, fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.5 },
        footStyles: { font: FONT, fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.8 },
        columnStyles,
        margin: { top: y + 4 },
        didParseCell: (data) => {
          data.cell.styles.font = FONT;
        },
        didDrawCell: (data) => {
          if (section.dividerBeforeCol != null && data.column.index === section.dividerBeforeCol) {
            doc.setLineWidth(1.6);
            doc.setDrawColor(0, 0, 0);
            doc.line(data.cell.x, data.cell.y, data.cell.x, data.cell.y + data.cell.height);
            doc.setLineWidth(0.5);
          }
        },
        didDrawPage: (data) => {
          if (data.pageNumber > 1 && data.cursor && data.cursor.y < 60) {
            drawPageHeader();
          }
          const pageLabel = tReportLabel("Page", lang);
          const ofLabel = tReportLabel("of", lang);
          const str = `${pageLabel} ${doc.getNumberOfPages()} ${ofLabel} {total_pages_count_string}`;
          doc.setFont(FONT, "normal");
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(str, pageW / 2, doc.internal.pageSize.getHeight() - 12, { align: "center" });
          doc.setTextColor(0);
        },
      });
    });

    if (typeof (doc as unknown as { putTotalPages?: (s: string) => void }).putTotalPages === "function") {
      (doc as unknown as { putTotalPages: (s: string) => void }).putTotalPages("{total_pages_count_string}");
    }

    const buf = doc.output("arraybuffer");
    await saveExport({
      subFolder: opts.subFolder || "Reports",
      fileName: opts.fileName,
      contents: buf,
      mime: "application/pdf",
    });
  })();
}

