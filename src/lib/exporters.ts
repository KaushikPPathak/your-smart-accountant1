// Shared exporters: PDF (jsPDF + autotable) and Excel (SheetJS).
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export interface PdfTableOptions {
  title: string;
  subtitle?: string;
  head: string[][];
  body: (string | number)[][];
  foot?: (string | number)[][];
  fileName: string;
  orientation?: "p" | "l";
  rightAlignCols?: number[]; // column indexes that should be right aligned (numeric)
}

export function downloadPdfTable(opts: PdfTableOptions): void {
  const doc = new jsPDF({ orientation: opts.orientation || "p", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(opts.title, pageW / 2, 36, { align: "center" });
  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(opts.subtitle, pageW / 2, 52, { align: "center" });
  }

  const columnStyles: Record<number, { halign: "right" }> = {};
  (opts.rightAlignCols || []).forEach((c) => (columnStyles[c] = { halign: "right" }));

  autoTable(doc, {
    startY: opts.subtitle ? 64 : 48,
    head: opts.head,
    body: opts.body,
    foot: opts.foot,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5 },
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.5 },
    footStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.8 },
    columnStyles,
    didDrawPage: () => {
      const str = `Page ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(str, pageW - 36, doc.internal.pageSize.getHeight() - 12, { align: "right" });
      doc.setTextColor(0);
    },
  });

  doc.save(opts.fileName);
}

export interface XlsxSheet {
  name: string;
  rows: (string | number)[][]; // first row may be header
}

export function downloadXlsx(fileName: string, sheets: XlsxSheet[]): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

// Convenience: paise → rupees number for sheets
export const r = (paise: number): number => Number((paise / 100).toFixed(2));
