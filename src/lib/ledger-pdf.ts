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

  // ── 2. In Tauri, generate a real PDF and save to disk ──
  if (runtime === "tauri") {
    let iframe: HTMLIFrameElement | null = null;
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { writeFile } = await import("@tauri-apps/plugin-fs");

      const appDir = await appLocalDataDir();
      const fileName = `ledger-${partyId}-${Date.now()}.pdf`;
      const filePath = await join(appDir, fileName);

      // Build HTML
      const html = buildLedgerHtml(info, liveEntries, vMap, fromDate, toDate);

      // Render into an ISOLATED iframe document. Rendering inside the app
      // document made html2canvas inherit the app's oklch() design tokens,
      // which its colour parser cannot read ("unsupported color function").
      // An iframe with no app stylesheet only ever computes plain hex colours.
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.width = "800px";
      iframe.style.height = "1200px";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);

      const idoc = iframe.contentDocument;
      if (!idoc) throw new Error("Could not create isolated render document");
      idoc.open();
      idoc.write(html);
      idoc.close();

      // Let the isolated document lay out before rasterising.
      await new Promise((r) => setTimeout(r, 60));

      const target = idoc.body;

      // Generate PDF blob
      const pdfBlob = await html2pdf()
        .set({
          margin: [10, 10],
          filename: fileName,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            windowWidth: 800,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(target)
        .output("blob");

      // Write to disk
      const arrayBuffer = await pdfBlob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(arrayBuffer));

      info.path = filePath;

      recordStage("whatsapp", "pdf", {
        path: filePath,
        absolute: true,
        party: info.partyName,
        source: "html2pdf",
        isolated: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordFailure("whatsapp", err, {
        stage: "pdf-write",
        runtime: "tauri",
        isolated: true,
        unsupported_color: /unsupported color function/i.test(msg)
          ? (msg.match(/"([^"]+)"/)?.[1] ?? "unknown")
          : undefined,
      });
    } finally {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
  } else {
    recordStage("whatsapp", "pdf", { path: null, absolute: false, source: "browser", runtime });
  }


  return info;
}

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
      <td style="border:1px solid #333;padding:6px">${formatDate(vDate)}</td>
      <td style="border:1px solid #333;padding:6px">${v.narration || v.voucher_number || ""}</td>
      <td style="border:1px solid #333;padding:6px;text-align:right">${e.debit_paise ? formatMoney(e.debit_paise) : ""}</td>
      <td style="border:1px solid #333;padding:6px;text-align:right">${e.credit_paise ? formatMoney(e.credit_paise) : ""}</td>
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
  /* Hard colour reset — html2canvas cannot parse oklch(), so every colour
     inside this document must be a plain hex/rgb value. */
  html, body, * { color: #000000; border-color: #333333; }
  html, body { background: #ffffff; }
  body { font-family: Arial, sans-serif; margin: 40px; color: #000; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; font-weight: normal; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
  th { border: 1px solid #333; padding: 6px; text-align: left; background: #f0f0f0; }
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
        <td colspan="2" style="border:1px solid #333;padding:6px"><strong>Opening Balance</strong></td>
        <td style="border:1px solid #333;padding:6px;text-align:right">${info.openingBalancePaise >= 0 ? formatMoney(info.openingBalancePaise) : ""}</td>
        <td style="border:1px solid #333;padding:6px;text-align:right">${info.openingBalancePaise < 0 ? formatMoney(info.openingBalancePaise) : ""}</td>
      </tr>
      ${rows}
      <tr>
        <td colspan="2" style="border:1px solid #333;padding:6px"><strong>Closing Balance</strong></td>
        <td style="border:1px solid #333;padding:6px;text-align:right">${info.closingBalancePaise >= 0 ? formatMoney(info.closingBalancePaise) : ""}</td>
        <td style="border:1px solid #333;padding:6px;text-align:right">${info.closingBalancePaise < 0 ? formatMoney(info.closingBalancePaise) : ""}</td>
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
