// src/lib/ledger-pdf.ts
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getNativeRuntime } from "./whatsapp-shared";
import { recordFailure, recordStage } from "./crash-log";

export interface LedgerPdfInfo {
  path: string | null;
  partyName: string;
  partyPhone: string | null;
  companyName: string;
  fromDate: string;
  toDate: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  balanceType: "Dr" | "Cr";
}

export async function downloadLedgerPdf(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<LedgerPdfInfo> {
  const runtime = getNativeRuntime();

  // ── 1. Fetch data from IndexedDB ──
  const { offlineDb } = await import("./offline/db");
  const p = (await offlineDb.cache_ledgers.get(partyId)) as any;
  const c = (await offlineDb.cache_companies.get(companyId)) as any;

  const entries = await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, partyId])
    .toArray();

  const liveEntries = (entries as any[]).filter(e => e.is_deleted !== true);
  const voucherIds = Array.from(new Set(liveEntries.map(e => e.voucher_id)));
  const vouchers = await offlineDb.cache_vouchers.where("id").anyOf(voucherIds).toArray();
  const vMap = new Map(vouchers.filter((v: any) => v.is_deleted !== true).map((v: any) => [String(v.id), v]));

  // Calculate Balances
  let movementBefore = 0;
  let totalDr = 0;
  let totalCr = 0;

  for (const e of liveEntries) {
    const v = vMap.get(String(e.voucher_id));
    if (!v) continue;
    const vDate = v.voucher_date || v.date || "";
    if (vDate && vDate < fromDate) {
      movementBefore += (e.debit_paise || 0) - (e.credit_paise || 0);
    } else if (vDate <= toDate) {
      totalDr += (e.debit_paise || 0);
      totalCr += (e.credit_paise || 0);
    }
  }

  const obSigned = (p?.opening_balance_is_debit ? 1 : -1) * (p?.opening_balance_paise || 0);
  const openingPaise = obSigned + movementBefore;
  const closingPaise = openingPaise + totalDr - totalCr;

  const info: LedgerPdfInfo = {
    path: null,
    partyName: p?.name || "Valued Party",
    partyPhone: p?.phone || null,
    companyName: c?.name || "Your Mehtaji",
    fromDate,
    toDate,
    openingBalancePaise: openingPaise,
    closingBalancePaise: closingPaise,
    balanceType: closingPaise >= 0 ? "Dr" : "Cr",
  };

  // ── 2. Direct PDF Generation (no HTML/Canvas) ──
  try {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    // Company Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(info.companyName, 105, 15, { align: "center" });

    // Ledger Details
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Ledger Account: ${info.partyName}`, 105, 22, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Period: ${formatDate(info.fromDate)} to ${formatDate(info.toDate)}`, 105, 28, { align: "center" });

    // Data Preparation
    const tableBody: (string | number)[][] = [];

    // Opening Balance Row
    tableBody.push([
      "",
      "Opening Balance",
      openingPaise >= 0 ? formatMoney(openingPaise) : "",
      openingPaise < 0 ? formatMoney(openingPaise) : "",
    ]);

    // Transaction Rows
    const sortedEntries = liveEntries
      .map(e => ({ e, v: vMap.get(String(e.voucher_id)) }))
      .filter(x => x.v && (x.v.voucher_date || x.v.date) >= fromDate && (x.v.voucher_date || x.v.date) <= toDate)
      .sort((a, b) => ((a.v.voucher_date || a.v.date) > (b.v.voucher_date || b.v.date) ? 1 : -1));

    for (const { e, v } of sortedEntries) {
      tableBody.push([
        formatDate(v.voucher_date || v.date || ""),
        v.narration || v.voucher_number || `Voucher #${v.id}`,
        e.debit_paise ? formatMoney(e.debit_paise) : "",
        e.credit_paise ? formatMoney(e.credit_paise) : "",
      ]);
    }

    // Closing Balance Row
    tableBody.push([
      "",
      "Closing Balance",
      closingPaise >= 0 ? formatMoney(closingPaise) : "",
      closingPaise < 0 ? formatMoney(closingPaise) : "",
    ]);

    autoTable(doc, {
      startY: 35,
      head: [["Date", "Particulars", "Debit (₹)", "Credit (₹)"]],
      body: tableBody,
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: "auto" },
        2: { cellWidth: 30, halign: "right" },
        3: { cellWidth: 30, halign: "right" },
      },
      foot: [
        [
          { content: "Summary", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
          { content: `Op: ${formatMoney(openingPaise)} ${openingPaise >= 0 ? "Dr" : "Cr"}`, colSpan: 1, styles: { halign: "right" } },
          { content: `Cl: ${formatMoney(closingPaise)} ${info.balanceType}`, colSpan: 1, styles: { halign: "right" } },
        ],
      ],
      footStyles: { fillColor: [240, 240, 240], textColor: 0, fontSize: 8 },
    });

    // ── 3. Save / Download based on runtime ──
    if (runtime === "tauri") {
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");

      const appDir = await appLocalDataDir();
      await mkdir(appDir, { recursive: true });

      const fileName = `ledger-${partyId}-${Date.now()}.pdf`;
      const filePath = await join(appDir, fileName);

      const pdfArrayBuffer = doc.output("arraybuffer");
      await writeFile(filePath, new Uint8Array(pdfArrayBuffer));
      info.path = filePath;
    } else if (runtime === "electron") {
      const fileName = `ledger-${partyId}-${Date.now()}.pdf`;
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      const filePath = await (window as any).yourMehtaji?.savePdf(fileName, pdfBase64);
      if (filePath) info.path = filePath;
    } else {
      // Browser: trigger actual download of the full PDF
      doc.save(`ledger-${partyId}-${Date.now()}.pdf`);
    }

    recordStage("whatsapp", "pdf", {
      path: info.path,
      source: "jspdf-autotable-direct",
      runtime,
    });
  } catch (err) {
    recordFailure("whatsapp", err, { stage: "pdf-write", runtime });
    throw err;
  }

  return info;
}

function formatDate(d: string): string {
  if (!d) return "";
  return d.split("-").reverse().join("-");
}

function formatMoney(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
