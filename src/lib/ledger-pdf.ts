// src/lib/ledger-pdf.ts
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

  // ── 2. In Tauri, generate PDF with jsPDF-autotable ──
  if (runtime === "tauri") {
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { writeFile } = await import("@tauri-apps/plugin-fs");

      const appDir = await appLocalDataDir();
      const fileName = `ledger-${partyId}-${Date.now()}.pdf`;
      const filePath = await join(appDir, fileName);

      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

      // Header
      doc.setFontSize(16);
      doc.text(info.companyName, 105, 15, { align: "center" });
      doc.setFontSize(12);
      doc.text(`Ledger Account: ${info.partyName}`, 105, 22, { align: "center" });
      doc.setFontSize(10);
      doc.text(`Period: ${formatDate(info.fromDate)} to ${formatDate(info.toDate)}`, 105, 28, { align: "center" });

      // Build table body
      const tableBody: (string | number)[][] = [];

      tableBody.push([
        "",
        "Opening Balance",
        info.openingBalancePaise >= 0 ? formatMoney(info.openingBalancePaise) : "",
        info.openingBalancePaise < 0 ? formatMoney(info.openingBalancePaise) : "",
      ]);

      for (const e of liveEntries) {
        const v = vMap.get(String(e.voucher_id));
        if (!v) continue;
        const vDate = v.voucher_date || v.date || "";
        if (vDate < fromDate || vDate > toDate) continue;

        tableBody.push([
          formatDate(vDate),
          v.narration || v.voucher_number || "",
          e.debit_paise ? formatMoney(e.debit_paise) : "",
          e.credit_paise ? formatMoney(e.credit_paise) : "",
        ]);
      }

      tableBody.push([
        "",
        "Closing Balance",
        info.closingBalancePaise >= 0 ? formatMoney(info.closingBalancePaise) : "",
        info.closingBalancePaise < 0 ? formatMoney(info.closingBalancePaise) : "",
      ]);

      autoTable(doc, {
        startY: 35,
        head: [["Date", "Particulars", "Debit (₹)", "Credit (₹)"]],
        body: tableBody,
        theme: "grid",
        headStyles: { fillColor: [220, 220, 220], textColor: 0, fontStyle: "bold" },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: "auto" },
          2: { cellWidth: 30, halign: "right" },
          3: { cellWidth: 30, halign: "right" },
        },
        didDrawPage: (data) => {
          // Footer on each page
          doc.setFontSize(8);
          doc.text(
            `Opening: ₹ ${formatMoney(info.openingBalancePaise)} ${info.openingBalancePaise >= 0 ? "Dr" : "Cr"}   |   Closing: ₹ ${formatMoney(info.closingBalancePaise)} ${info.balanceType}`,
            105,
            doc.internal.pageSize.height - 10,
            { align: "center" }
          );
        },
      });

      const pdfBlob = doc.output("blob");
      const arrayBuffer = await pdfBlob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(arrayBuffer));

      info.path = filePath;

      recordStage("whatsapp", "pdf", {
        path: filePath,
        absolute: true,
        party: info.partyName,
        source: "jspdf-autotable",
      });
    } catch (err) {
      recordFailure("whatsapp", err, { stage: "pdf-write", runtime: "tauri" });
    }
  } else {
    recordStage("whatsapp", "pdf", { path: null, absolute: false, source: "browser", runtime });
  }

  return info;
}

function formatDate(d: string): string {
  return d.split("-").reverse().join("-");
}

function formatMoney(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
