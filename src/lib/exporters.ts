// Shared exporters: PDF (jsPDF + autotable) and Excel (SheetJS).
// Files are routed through the desktop saver — in the .exe they land in
// Documents/YourMehtaji/Exports/<Company>/<subFolder>/ and auto-open;
// in the browser they fall back to a normal download.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveExport } from "./desktop-save";

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
}

export function downloadPdfTable(opts: PdfTableOptions): void {
  const doc = new jsPDF({ orientation: opts.orientation || "p", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  let y = 28;
  if (opts.companyName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
    y += 14;
  }
  if (opts.companySubLine) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(opts.companySubLine, pageW / 2, y, { align: "center" });
    y += 12;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(opts.title, pageW / 2, y, { align: "center" });
  y += 14;
  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(opts.subtitle, pageW / 2, y, { align: "center" });
    y += 12;
  }
  const tableStartY = y + 4;

  const columnStyles: Record<number, { halign: "right" }> = {};
  (opts.rightAlignCols || []).forEach((c) => (columnStyles[c] = { halign: "right" }));

  autoTable(doc, {
    startY: tableStartY,
    head: opts.head,
    body: opts.body,
    foot: opts.foot,
    showFoot: "lastPage",
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5 },
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.5 },
    footStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.8 },
    columnStyles,
    margin: { top: tableStartY },
    didDrawPage: (data) => {
      // Repeat company / FY / title on every page (page 2+).
      if (data.pageNumber > 1) {
        let hy = 28;
        if (opts.companyName) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(13);
          doc.text(opts.companyName.toUpperCase(), pageW / 2, hy, { align: "center" });
          hy += 14;
        }
        if (opts.companySubLine) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.text(opts.companySubLine, pageW / 2, hy, { align: "center" });
          hy += 12;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(opts.title, pageW / 2, hy, { align: "center" });
        if (opts.subtitle) {
          hy += 14;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.text(opts.subtitle, pageW / 2, hy, { align: "center" });
        }
      }
      const pageW2 = doc.internal.pageSize.getWidth();
      const str = `Page ${doc.getNumberOfPages()} of {total_pages_count_string}`;
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
  void saveExport({
    subFolder: opts.subFolder || "Reports",
    fileName: opts.fileName,
    contents: buf,
    mime: "application/pdf",
  });
}

export interface XlsxSheet {
  name: string;
  rows: (string | number)[][]; // first row may be header
}

export function downloadXlsx(fileName: string, sheets: XlsxSheet[], subFolder = "Reports"): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  void saveExport({
    subFolder,
    fileName,
    contents: buf,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Convenience: paise → rupees number for sheets
export const r = (paise: number): number => Number((paise / 100).toFixed(2));

export interface PdfSection {
  /** Section heading printed bold above this section's table. */
  sectionTitle: string;
  /** Optional secondary line under the section title. */
  sectionSubtitle?: string;
  head: string[][];
  body: (string | number)[][];
  foot?: (string | number)[][];
  rightAlignCols?: number[];
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
  const doc = new jsPDF({ orientation: opts.orientation || "p", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  const drawPageHeader = (): number => {
    let y = 28;
    if (opts.companyName) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(opts.companyName.toUpperCase(), pageW / 2, y, { align: "center" });
      y += 14;
    }
    if (opts.companySubLine) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(opts.companySubLine, pageW / 2, y, { align: "center" });
      y += 12;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(opts.title, pageW / 2, y, { align: "center" });
    y += 14;
    if (opts.subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(opts.subtitle, pageW / 2, y, { align: "center" });
      y += 12;
    }
    return y + 4;
  };

  opts.sections.forEach((section, idx) => {
    if (idx > 0) doc.addPage();
    let y = drawPageHeader();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.sectionTitle, pageW / 2, y, { align: "center" });
    y += 13;
    if (section.sectionSubtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(section.sectionSubtitle, pageW / 2, y, { align: "center" });
      y += 11;
    }
    const columnStyles: Record<number, { halign: "right" }> = {};
    (section.rightAlignCols || []).forEach((c) => (columnStyles[c] = { halign: "right" }));
    autoTable(doc, {
      startY: y + 4,
      head: section.head,
      body: section.body,
      foot: section.foot,
      showFoot: "lastPage",
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5 },
      headStyles: { fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.5 },
      footStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.8 },
      columnStyles,
      margin: { top: y + 4 },
      didDrawPage: (data) => {
        // For continuation pages within a section, repeat the doc-level header only.
        if (data.pageNumber > 1 && data.cursor && data.cursor.y < 60) {
          drawPageHeader();
        }
        const str = `Page ${doc.getNumberOfPages()} of {total_pages_count_string}`;
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
  void saveExport({
    subFolder: opts.subFolder || "Reports",
    fileName: opts.fileName,
    contents: buf,
    mime: "application/pdf",
  });
}

