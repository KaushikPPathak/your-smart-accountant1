import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { LedgerPdfInfo } from "./ledger-pdf";

export interface LedgerPdfTransaction {
  id: string;
  date: string;
  particulars: string;
  voucherType: string;
  voucherNumber: string;
  reference: string;
  debitPaise: number;
  creditPaise: number;
}

export function chronologicalLedgerRows(transactions: LedgerPdfTransaction[], openingPaise: number) {
  let balancePaise = openingPaise;
  return [...transactions].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.voucherNumber.localeCompare(b.voucherNumber, "en", { numeric: true }) ||
    a.id.localeCompare(b.id),
  ).map(transaction => {
    balancePaise += transaction.debitPaise - transaction.creditPaise;
    return { ...transaction, balancePaise };
  });
}

const money = (paise: number) => (Math.abs(paise) / 100).toLocaleString("en-IN", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const balance = (paise: number) => `${money(paise)} ${paise < 0 ? "Cr" : "Dr"}`;
const dateLabel = (date: string) => date.split("-").reverse().join("-");

/** One table paginates both debit and credit movements in a single date sequence. */
export function renderLedgerPdf(doc: jsPDF, font: string, info: LedgerPdfInfo, transactions: LedgerPdfTransaction[]): void {
  const rows = chronologicalLedgerRows(transactions, info.openingBalancePaise);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  doc.setFont(font, "bold");
  doc.setFontSize(13);
  const companyLines: string[] = doc.splitTextToSize(info.companyName.toUpperCase(), width - 24);
  doc.setFontSize(10);
  const partyLines: string[] = doc.splitTextToSize(`Ledger Account: ${info.partyName}`, width - 24);
  const headerBottom = 12 + companyLines.length * 6 + partyLines.length * 5 + 9;
  const body = [
    [dateLabel(info.fromDate), "Opening balance", "", "", "", "", "", balance(info.openingBalancePaise)],
    ...rows.map(row => [
      dateLabel(row.date), row.particulars, row.voucherType, row.voucherNumber, row.reference,
      row.debitPaise ? money(row.debitPaise) : "",
      row.creditPaise ? money(row.creditPaise) : "", balance(row.balancePaise),
    ]),
    ["", "Period totals", "", "", "",
      money(rows.reduce((sum, row) => sum + row.debitPaise, 0)),
      money(rows.reduce((sum, row) => sum + row.creditPaise, 0)), ""],
    [dateLabel(info.toDate), "Closing balance", "", "", "", "", "", balance(info.closingBalancePaise)],
  ];
  autoTable(doc, {
    startY: headerBottom, margin: { top: headerBottom, bottom: 14, left: 10, right: 10 },
    tableWidth: width - 20, theme: "grid", showHead: "everyPage", rowPageBreak: "avoid",
    head: [["DATE", "PARTICULARS", "VCH TYPE", "VCH NO", "REFERENCE", "DEBIT (INR)", "CREDIT (INR)", "BALANCE (INR)"]],
    body,
    styles: { font, fontSize: 8, cellPadding: 1.7, overflow: "linebreak", textColor: 0, fillColor: 255, lineColor: 100, lineWidth: 0.1 },
    headStyles: { fontStyle: "bold", fillColor: 240, textColor: 0 },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 74 }, 2: { cellWidth: 23 },
      3: { cellWidth: 23 }, 4: { cellWidth: 33 },
      5: { cellWidth: 32, halign: "right" }, 6: { cellWidth: 32, halign: "right" },
      7: { cellWidth: width - 259, halign: "right" },
    },
    didParseCell: data => {
      if (data.section === "body" && (data.row.index === 0 || data.row.index >= body.length - 2)) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: () => {
      doc.setTextColor(0);
      doc.setFont(font, "bold");
      doc.setFontSize(13);
      doc.text(companyLines, width / 2, 12, { align: "center" });
      doc.setFontSize(10);
      const partyY = 12 + companyLines.length * 6;
      doc.text(partyLines, width / 2, partyY, { align: "center" });
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.text(`Period: ${dateLabel(info.fromDate)} to ${dateLabel(info.toDate)}`, width / 2,
        partyY + partyLines.length * 5, { align: "center" });
    },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.text(`Page ${page} of ${pages}`, width - 10, height - 6, { align: "right" });
  }
}