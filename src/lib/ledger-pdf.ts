import { renderLedgerPdf } from "./ledger-pdf-document";
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
    if (!vDate) continue;
    if (vDate < fromDate) {
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

  // ── 2. Chronological ledger statement (Landscape A4) ──
  try {
    const [{ jsPDF }, { prepareReportFont }, { getStoredLang }] = await Promise.all([
      import("jspdf"), import("./pdf-fonts"), import("./i18n"),
    ]);
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const reportFont = await prepareReportFont(doc, getStoredLang());
    const transactions = liveEntries.flatMap(e => {
      const v = vMap.get(String(e.voucher_id));
      const date = v?.voucher_date || v?.date || "";
      if (!v || !date || date < fromDate || date > toDate) return [];
      return [{
        id: String(e.id || v.id), date,
        particulars: v.narration || `${v.voucher_type || "Voucher"} ${v.voucher_number || ""}`.trim(),
        voucherType: v.voucher_type || "", voucherNumber: String(v.voucher_number || ""),
        reference: v.reference || "", debitPaise: e.debit_paise || 0, creditPaise: e.credit_paise || 0,
      }];
    });
    renderLedgerPdf(doc, reportFont, info, transactions);

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
      const result = await (window as any).yourMehtaji?.savePdf(fileName, pdfBase64);
      const filePath = typeof result === "string" ? result : result?.path;
      if (filePath) info.path = filePath;
    } else {
      // Browser: real download
      doc.save(`ledger-${partyId}-${Date.now()}.pdf`);
    }

    recordStage("whatsapp", "pdf", {
      path: info.path,
      source: "jspdf-autotable-chronological",
      runtime,
    });
  } catch (err) {
    recordFailure("whatsapp", err, { stage: "pdf-write", runtime });
    throw err;
  }

  return info;
}

