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

  // ── 2. T-Format PDF Generation (Landscape A4) ──
  try {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });

    // Centered header block
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(info.companyName.toUpperCase(), 148.5, 12, { align: "center" });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Ledger Account: ${info.partyName}`, 148.5, 19, { align: "center" });

    doc.setFontSize(10);
    doc.text(`FY 2025-26`, 148.5, 25, { align: "center" });
    doc.text(`(From ${formatDate(info.fromDate)} to ${formatDate(info.toDate)})`, 148.5, 30, { align: "center" });



    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${info.partyName} Account`, 148.5, 38, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`for the period ${formatDate(info.fromDate)} to ${formatDate(info.toDate)}`, 148.5, 43, { align: "center" });


    // Filter & sort entries inside the date range
    const sortedEntries = liveEntries
      .map(e => ({ e, v: vMap.get(String(e.voucher_id)) }))
      .filter(x => x.v && (x.v.voucher_date || x.v.date) >= fromDate && (x.v.voucher_date || x.v.date) <= toDate)
      .sort((a, b) => ((a.v.voucher_date || a.v.date) > (b.v.voucher_date || b.v.date) ? 1 : -1));

    const drEntries = sortedEntries.filter(({ e }) => (e.debit_paise || 0) > 0);
    const crEntries = sortedEntries.filter(({ e }) => (e.credit_paise || 0) > 0);

    // Opening balance placement
    const obDr = openingPaise > 0 ? openingPaise : 0;
    const obCr = openingPaise < 0 ? Math.abs(openingPaise) : 0;

    // T-format balancing: closing balance goes to the shorter side so both totals match
    const drSideSum = obDr + totalDr;
    const crSideSum = obCr + totalCr;
    const grandTotal = Math.max(drSideSum, crSideSum);
    const cbDr = crSideSum > drSideSum ? crSideSum - drSideSum : 0;
    const cbCr = drSideSum > crSideSum ? drSideSum - crSideSum : 0;

    const startY = 52;
    const tableW = 138; // mm per side
    const leftX = 8;
    const rightX = 151;


    // ── DR. Table (Left) ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("DR.", leftX + tableW / 2, startY - 2, { align: "center" });

    const drBody: (string | number)[][] = [];
    if (obDr > 0) drBody.push(["", "To Opening Balance", "", "", "", formatMoney(obDr)]);
    for (const { e, v } of drEntries) {
      drBody.push([
        formatDate(v.voucher_date || v.date || ""),
        v.narration || `Voucher #${v.id}`,
        v.voucher_type || "",
        v.voucher_number || "",
        v.reference || "",
        formatMoney(e.debit_paise),
      ]);
    }
    if (cbDr > 0) drBody.push(["", "To Balance c/d", "", "", "", formatMoney(cbDr)]);
    drBody.push(["", "Total", "", "", "", formatMoney(grandTotal)]);

    autoTable(doc, {
      startY,
      margin: { left: leftX, right: 297 - leftX - tableW },
      tableWidth: tableW,
      head: [["Date", "Particulars", "Vch Type", "Vch No", "Chq/Ref", "Amount"]],


      body: drBody,
      theme: "grid",
      showHead: "everyPage",
      headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold", fontSize: 8 },

      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 42 },
        2: { cellWidth: 20 },
        3: { cellWidth: 15 },
        4: { cellWidth: 20 },
        5: { cellWidth: 20, halign: "right" },
      },
    });
    const drFinalY = (doc as any).lastAutoTable.finalY;

    // ── CR. Table (Right) ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("CR.", rightX + tableW / 2, startY - 2, { align: "center" });

    const crBody: (string | number)[][] = [];
    if (obCr > 0) crBody.push(["", "By Opening Balance", "", "", "", formatMoney(obCr)]);
    for (const { e, v } of crEntries) {
      crBody.push([
        formatDate(v.voucher_date || v.date || ""),
        v.narration || `Voucher #${v.id}`,
        v.voucher_type || "",
        v.voucher_number || "",
        v.reference || "",
        formatMoney(e.credit_paise),
      ]);
    }
    if (cbCr > 0) crBody.push(["", "By Balance c/d", "", "", "", formatMoney(cbCr)]);
    crBody.push(["", "Total", "", "", "", formatMoney(grandTotal)]);

    autoTable(doc, {
      startY,
      margin: { left: rightX, right: 297 - rightX - tableW },
      tableWidth: tableW,
      head: [["Date", "Particulars", "Vch Type", "Vch No", "Chq/Ref", "Amount"]],

      body: crBody,
      theme: "grid",
      showHead: "everyPage",
      headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold", fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 42 },
        2: { cellWidth: 20 },
        3: { cellWidth: 15 },
        4: { cellWidth: 20 },
        5: { cellWidth: 20, halign: "right" },
      },
    });
    const crFinalY = (doc as any).lastAutoTable.finalY;

    // ── Closing Balance below tables ──
    const finalY = Math.max(drFinalY, crFinalY) + 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setFont("helvetica", "bold");
    doc.text("Closing balance", leftX + 1, finalY);
    doc.text(`${formatMoney(closingPaise)} ${info.balanceType}`, rightX + tableW - 1, finalY, { align: "right" });




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
      // Browser: real download
      doc.save(`ledger-${partyId}-${Date.now()}.pdf`);
    }

    recordStage("whatsapp", "pdf", {
      path: info.path,
      source: "jspdf-autotable-tformat",
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
  return `${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

