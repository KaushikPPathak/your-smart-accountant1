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
  /** Explicit per-column widths (pt). Use to force symmetry (e.g. Dr/Cr T-format). */
  columnWidths?: Record<number, number>;
  /** Folder under the company export root. Defaults to "Reports". */
  subFolder?: string;
  /** Draw a thick vertical divider on the LEFT edge of this column (e.g. T-shape ledger center). */
  dividerBeforeCol?: number;
  /** Optional callback invoked after the table has rendered on the last page.
   *  Use it to draw wrapped paragraphs, signature blocks, etc. within page margins. */
  afterTable?: (ctx: {
    doc: jsPDFType;
    finalY: number;
    pageWidth: number;
    pageHeight: number;
    margin: number;
    font: string;
  }) => void;
}

// Rows per autoTable chunk. autoTable is synchronous, so we render the body
// in chunks and yield between them (setTimeout 0) to keep the UI responsive
// on very large ledger PDFs. Each chunk continues from the previous chunk's
// finalY so the visible table remains contiguous across page breaks.
const PDF_ROW_CHUNK = 500;
const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

    const { showExportProgress } = await import("@/lib/export-progress");
    let aborted = false;
    const progress = showExportProgress(opts.fileName, body.length, {
      onCancel: () => { aborted = true; },
    });

    let y = 28;
    if (opts.companyName) {
      doc.setFont(FONT, "bold");
      doc.setFontSize(14);
      doc.setTextColor(0, 32, 96); // dark blue
      doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
      doc.setTextColor(0, 0, 0);
      y += 15;
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

    const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
    (opts.rightAlignCols || []).forEach((c) => (columnStyles[c] = { ...(columnStyles[c] || {}), halign: "right" }));
    if (opts.columnWidths) {
      for (const [k, w] of Object.entries(opts.columnWidths)) {
        const i = Number(k);
        columnStyles[i] = { ...(columnStyles[i] || {}), cellWidth: w };
      }
    }

    const drawPageChrome = () => {
      let hy = 28;
      if (opts.companyName) {
        doc.setFont(FONT, "bold");
        doc.setFontSize(14);
        doc.setTextColor(0, 32, 96);
        doc.text(opts.companyName.toUpperCase(), pageW / 2, hy, { align: "center" });
        doc.setTextColor(0, 0, 0);
        hy += 15;
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
    };

    const chunkCount = Math.max(1, Math.ceil(body.length / PDF_ROW_CHUNK));
    let rowsDone = 0;
    let nextY = tableStartY;
    for (let ci = 0; ci < chunkCount; ci++) {
      if (aborted) return;
      const slice = body.slice(ci * PDF_ROW_CHUNK, (ci + 1) * PDF_ROW_CHUNK);
      const isFirst = ci === 0;
      const isLast = ci === chunkCount - 1;
      autoTable(doc, {
        startY: nextY,
        head: isFirst ? head : undefined,
        body: slice,
        foot: isLast ? foot : undefined,
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: FONT, fontSize: 9, cellPadding: 3, lineColor: [80, 80, 80], lineWidth: 0.2, textColor: 20 },
      headStyles: { font: FONT, fillColor: false as unknown as [number, number, number], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.4 },
      footStyles: { font: FONT, fillColor: false as unknown as [number, number, number], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.4 },
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
        if (data.pageNumber > 1 || !isFirst) {
          drawPageChrome();
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
      const lastAT = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      nextY = lastAT?.finalY ?? nextY;
      rowsDone += slice.length;
      progress.update(rowsDone);
      await yieldToUi();
    }
    if (aborted) return;
    if (opts.afterTable) {
      try {
        opts.afterTable({
          doc,
          finalY: nextY,
          pageWidth: doc.internal.pageSize.getWidth(),
          pageHeight: doc.internal.pageSize.getHeight(),
          margin: 28,
          font: FONT,
        });
      } catch (e) {
        console.warn("afterTable hook failed", e);
      }
    }
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
    progress.done();
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
    let activeWorker: Worker | null = null;
    const progress = showExportProgress(fileName, totalRows, {
      onCancel: () => {
        try { activeWorker?.terminate(); } catch { /* ignore */ }
        activeWorker = null;
      },
    });

    const runInWorker = async (): Promise<ArrayBuffer> =>
      await new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/xlsx-export.worker.ts", import.meta.url),
          { type: "module" },
        );
        activeWorker = worker;
        worker.onmessage = (ev: MessageEvent<{
          type: "progress" | "done" | "error";
          buffer?: ArrayBuffer; message?: string;
          rowsDone?: number; rowsTotal?: number; stage?: string;
        }>) => {
          if (progress.cancelled()) return;
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
      if (progress.cancelled()) return;
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

    if (progress.cancelled()) return;
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
  /** Explicit per-column widths (pt). Use to force symmetry (e.g. Dr/Cr T-format). */
  columnWidths?: Record<number, number>;
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
        doc.setFontSize(14);
        doc.setTextColor(0, 32, 96);
        doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
        doc.setTextColor(0, 0, 0);
        y += 15;
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

    const totalRows = opts.sections.reduce((n, s) => n + s.body.length, 0);
    const { showExportProgress } = await import("@/lib/export-progress");
    let aborted = false;
    const progress = showExportProgress(opts.fileName, totalRows, {
      onCancel: () => { aborted = true; },
    });
    let rowsDone = 0;

    // Reserve page 1 as the Index (TOC). We'll fill in the entries after
    // sections render so the page numbers listed are accurate.
    drawPageHeader();
    const startPages: number[] = [];

    for (let idx = 0; idx < opts.sections.length; idx++) {
      if (aborted) return;
      const section = opts.sections[idx];
      // Every section starts on a fresh page (first section moves off TOC page).
      doc.addPage();
      startPages.push(doc.getNumberOfPages());
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

      const sectionBody = localizeExportRows(section.body as (string | number)[][], lang);
      const sectionHead = localizeExportRows(section.head, lang);
      const sectionFoot = section.foot ? localizeExportRows(section.foot as (string | number)[][], lang) : undefined;
      const chunkCount = Math.max(1, Math.ceil(sectionBody.length / PDF_ROW_CHUNK));
      let nextY = y + 4;
      for (let ci = 0; ci < chunkCount; ci++) {
        if (aborted) return;
        const slice = sectionBody.slice(ci * PDF_ROW_CHUNK, (ci + 1) * PDF_ROW_CHUNK);
        const isFirst = ci === 0;
        const isLast = ci === chunkCount - 1;
        autoTable(doc, {
          startY: nextY,
          head: isFirst ? sectionHead : undefined,
          body: slice,
          foot: isLast ? sectionFoot : undefined,
          showFoot: "lastPage",
          theme: "grid",
          styles: { font: FONT, fontSize: 9, cellPadding: 3, lineColor: [80, 80, 80], lineWidth: 0.2, textColor: 20 },
          headStyles: { font: FONT, fillColor: false as unknown as [number, number, number], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.4 },
          footStyles: { font: FONT, fillColor: false as unknown as [number, number, number], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.4 },
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
        const lastAT = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
        nextY = lastAT?.finalY ?? nextY;
        rowsDone += slice.length;
        progress.update(rowsDone, `section ${idx + 1}/${opts.sections.length}`);
        await yieldToUi();
      }
    }

    // ---- Fill the reserved Index (TOC) page ----
    if (opts.sections.length > 0) {
      doc.setPage(1);
      const indexLabel = "Index";
      doc.setFont(FONT, "bold");
      doc.setFontSize(12);
      doc.text(indexLabel, pageW / 2, 90, { align: "center" });
      const tocBody = opts.sections.map((s, i) => [
        String(i + 1),
        localizeExportText(s.sectionTitle, lang),
        String(startPages[i] ?? ""),
      ]);
      autoTable(doc, {
        startY: 100,
        head: [["#", "Ledger / Section", "Page"]],
        body: tocBody,
        theme: "grid",
        styles: { font: FONT, fontSize: 9, cellPadding: 3, lineColor: [80, 80, 80], lineWidth: 0.2, textColor: 20 },
        headStyles: { font: FONT, fillColor: false as unknown as [number, number, number], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.4 },
        columnStyles: { 0: { halign: "right", cellWidth: 40 }, 2: { halign: "right", cellWidth: 60 } },
        margin: { left: 40, right: 40 },
        didParseCell: (data) => { data.cell.styles.font = FONT; },
      });
      // Footer page number on the TOC page.
      const pageLabel = tReportLabel("Page", lang);
      const ofLabel = tReportLabel("of", lang);
      doc.setFont(FONT, "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `${pageLabel} 1 ${ofLabel} {total_pages_count_string}`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 12,
        { align: "center" },
      );
      doc.setTextColor(0);
    }


    if (aborted) return;
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
    progress.done();
  })();
}

