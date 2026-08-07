// src/lib/ledger-pdf.ts
import { getNativeRuntime } from "./whatsapp-shared";
import { recordFailure, recordStage } from "./crash-log";

export interface LedgerPdfInfo {
  path: string | null;           // absolute path to generated file (for Tauri clipboard)
  partyName: string;
  partyPhone: string | null;
  companyName: string;
  fromDate: string;              // e.g. "01-Apr-2025"
  toDate: string;                // e.g. "07-Aug-2026"
  openingBalancePaise: number;   // positive = Dr, negative = Cr
  closingBalancePaise: number;   // positive = Dr, negative = Cr
  balanceType: "Dr" | "Cr";
}

export async function downloadLedgerPdf(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<LedgerPdfInfo> {
  const runtime = getNativeRuntime();

  // ── 1. Calculate real ledger data from IndexedDB (works in Tauri AND browser) ──
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

  // ── 2. In Tauri, write the statement to disk so it can be attached ──
  if (runtime === "tauri") {
    try {
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { writeFile } = await import("@tauri-apps/plugin-fs");

      const appDir = await appLocalDataDir();
      const fileName = `ledger-${partyId}-${Date.now()}.html`;
      const filePath = await join(appDir, fileName);

      const html = buildLedgerHtml(info, liveEntries, vMap, fromDate, toDate);
      await writeFile(filePath, new TextEncoder().encode(html));

      info.path = filePath;

      const absolute = /^([a-zA-Z]:[\\\/]|\\\\|\/)/.test(filePath);
      recordStage("whatsapp", "pdf", {
        path: filePath,
        absolute,
        party: info.partyName,
        source: "frontend-fs",
      });
    } catch (err) {
      recordFailure("whatsapp", err, { stage: "pdf-write", runtime: "tauri" });
      // path stays null, WhatsApp will show manual-attach fallback
    }
  } else {
    recordStage("whatsapp", "pdf", { path: null, absolute: false, source: "browser", runtime });
  }

  return info;
}

/** Build a simple HTML ledger statement that can be attached to WhatsApp. */
function buildLedgerHtml(
  info: LedgerPdfInfo,
  entries: any[],
  vMap: Map<string, any>,
  fromDate: string,
  toDate: string,
): string {
  const formatDate = (d: string) => d.split("-").reverse().join("-");
  const formatMoney = (paise: number) => {
    const rupees = Math.abs(paise) / 100;
    return rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  let rows = "";
  for (const e of entries) {
    const v = vMap.get(String(e.voucher_id));
    if (!v) continue;
    const vDate = v.voucher_date || v.date || "";
    if (vDate < fromDate || vDate > toDate) continue;

    rows += `<tr>
      <td>${formatDate(vDate)}</td>
      <td>${v.narration || v.voucher_number || ""}</td>
      <td style="text-align:right">${e.debit_paise ? formatMoney(e.debit_paise) : ""}</td>
      <td style="text-align:right">${e.credit_paise ? formatMoney(e.credit_paise) : ""}</td>
    </tr>`;
  }

  const obSign = info.openingBalancePaise >= 0 ? "Dr" : "Cr";
  const cbSign = info.balanceType;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Ledger Statement - ${info.partyName}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #000; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; font-weight: normal; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
  th, td { border: 1px solid #333; padding: 6px; text-align: left; }
  th { background: #f0f0f0; }
  .num { text-align: right; }
  .summary { margin-top: 20px; font-size: 13px; }
  .summary div { margin: 4px 0; }
</style>
</head>
<body>
  <h1>${info.companyName}</h1>
  <h2>Ledger Account: ${info.partyName}</h2>
  <h2>Period: ${formatDate(info.fromDate)} to ${formatDate(info.toDate)}</h2>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Particulars</th>
        <th class="num">Debit (₹)</th>
        <th class="num">Credit (₹)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="2"><strong>Opening Balance</strong></td>
        <td class="num">${info.openingBalancePaise >= 0 ? formatMoney(info.openingBalancePaise) : ""}</td>
        <td class="num">${info.openingBalancePaise < 0 ? formatMoney(info.openingBalancePaise) : ""}</td>
      </tr>
      ${rows}
      <tr>
        <td colspan="2"><strong>Closing Balance</strong></td>
        <td class="num">${info.closingBalancePaise >= 0 ? formatMoney(info.closingBalancePaise) : ""}</td>
        <td class="num">${info.closingBalancePaise < 0 ? formatMoney(info.closingBalancePaise) : ""}</td>
      </tr>
    </tbody>
  </table>

  <div class="summary">
    <div><strong>Opening Balance:</strong> ₹ ${formatMoney(info.openingBalancePaise)} ${obSign}</div>
    <div><strong>Closing Balance:</strong> ₹ ${formatMoney(info.closingBalancePaise)} ${cbSign}</div>
  </div>
</body>
</html>`;
}
