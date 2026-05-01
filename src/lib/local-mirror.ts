// Trial-mode "local copy on PC" mirror.
// For companies with mode = 'trial_local', writes BOTH:
//   - <Company>/backups/<Company>_<timestamp>.json   (full restore file)
//   - <Company>/backups/<Company>_<timestamp>.xlsx   (human-readable workbook)
//   - <Company>/latest/<Company>_latest.json
//   - <Company>/latest/<Company>_latest.xlsx
// In Electron desktop builds the files are written silently to disk.
// In a browser tab the user gets a manual download for both files.

import * as XLSX from "xlsx";
import { buildCompanyBackup, type CompanyBackup } from "./backup";

interface ElectronAPI {
  isDesktop: true;
  saveCompanyFile: (
    company: string,
    subFolder: string,
    fileName: string,
    contents: string | ArrayBuffer | Uint8Array,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
}
function electron(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { yourMehtaji?: ElectronAPI };
  return w.yourMehtaji?.isDesktop ? w.yourMehtaji : null;
}

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function browserDownload(fileName: string, contents: string | Uint8Array, mime: string): void {
  let blob: Blob;
  if (typeof contents === "string") {
    blob = new Blob([contents], { type: mime });
  } else {
    const copy = new Uint8Array(contents.byteLength);
    copy.set(contents);
    blob = new Blob([copy.buffer], { type: mime });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Workbook builder ----------
function paiseToRupees(p: unknown): number {
  const n = typeof p === "number" ? p : Number(p ?? 0);
  return Number.isFinite(n) ? n / 100 : 0;
}

function buildWorkbook(b: CompanyBackup, companyName: string): Uint8Array {
  const wb = XLSX.utils.book_new();

  // Company sheet
  const c = b.company ?? {};
  const companyRows = [
    ["Field", "Value"],
    ["Company name", String(c["name"] ?? companyName)],
    ["GSTIN", String(c["gstin"] ?? "")],
    ["PAN", String(c["pan"] ?? "")],
    ["State", String(c["state"] ?? "")],
    ["State code", String(c["state_code"] ?? "")],
    ["Financial year start", String(c["financial_year_start"] ?? "")],
    ["Mode", String(c["mode"] ?? "normal")],
    ["Exported at", b.exported_at],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(companyRows), "Company");

  // Ledgers
  const ledgerRows = [
    ["Name", "Type", "Group", "GSTIN", "State", "Opening (₹)", "Dr/Cr"],
    ...b.ledgers.map((l) => [
      String(l["name"] ?? ""),
      String(l["type"] ?? ""),
      String(l["group_code"] ?? ""),
      String(l["gstin"] ?? ""),
      String(l["state"] ?? ""),
      paiseToRupees(l["opening_balance_paise"]),
      l["opening_balance_is_debit"] ? "Dr" : "Cr",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledgerRows), "Ledgers");

  // Items
  const itemRows = [
    ["Name", "HSN", "Unit", "GST %", "Opening Qty", "Opening Rate (₹)", "Sale price (₹)", "Purchase price (₹)"],
    ...b.items.map((i) => [
      String(i["name"] ?? ""),
      String(i["hsn_code"] ?? ""),
      String(i["unit"] ?? ""),
      Number(i["gst_rate"] ?? 0),
      Number(i["opening_stock_qty"] ?? 0),
      paiseToRupees(i["opening_stock_rate_paise"]),
      paiseToRupees(i["sale_price_paise"]),
      paiseToRupees(i["purchase_price_paise"]),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(itemRows), "Items");

  // Vouchers (lookup map for party name)
  const ledgerName = new Map<string, string>();
  for (const l of b.ledgers) ledgerName.set(String(l["id"] ?? ""), String(l["name"] ?? ""));

  const voucherRows = [
    ["Date", "Type", "Number", "Party", "Subtotal (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round-off (₹)", "Total (₹)", "Narration"],
    ...b.vouchers.map((v) => [
      String(v["voucher_date"] ?? ""),
      String(v["voucher_type"] ?? ""),
      String(v["voucher_number"] ?? ""),
      ledgerName.get(String(v["party_ledger_id"] ?? "")) ?? "",
      paiseToRupees(v["subtotal_paise"]),
      paiseToRupees(v["cgst_paise"]),
      paiseToRupees(v["sgst_paise"]),
      paiseToRupees(v["igst_paise"]),
      paiseToRupees(v["round_off_paise"]),
      paiseToRupees(v["total_paise"]),
      String(v["narration"] ?? ""),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(voucherRows), "Vouchers");

  // Voucher items
  const itemName = new Map<string, string>();
  for (const i of b.items) itemName.set(String(i["id"] ?? ""), String(i["name"] ?? ""));
  const vNumber = new Map<string, string>();
  for (const v of b.vouchers) vNumber.set(String(v["id"] ?? ""), String(v["voucher_number"] ?? ""));

  const viRows = [
    ["Voucher #", "Item", "Description", "Qty", "Rate (₹)", "Discount (₹)", "Taxable (₹)", "GST %", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Amount (₹)"],
    ...b.voucher_items.map((vi) => [
      vNumber.get(String(vi["voucher_id"] ?? "")) ?? "",
      itemName.get(String(vi["item_id"] ?? "")) ?? "",
      String(vi["description"] ?? ""),
      Number(vi["qty"] ?? 0),
      paiseToRupees(vi["rate_paise"]),
      paiseToRupees(vi["discount_paise"]),
      paiseToRupees(vi["taxable_paise"]),
      Number(vi["gst_rate"] ?? 0),
      paiseToRupees(vi["cgst_paise"]),
      paiseToRupees(vi["sgst_paise"]),
      paiseToRupees(vi["igst_paise"]),
      paiseToRupees(vi["amount_paise"]),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(viRows), "Voucher_Items");

  // Voucher entries (Dr/Cr postings)
  const veRows = [
    ["Voucher #", "Ledger", "Debit (₹)", "Credit (₹)", "Narration"],
    ...b.voucher_entries.map((ve) => [
      vNumber.get(String(ve["voucher_id"] ?? "")) ?? "",
      ledgerName.get(String(ve["ledger_id"] ?? "")) ?? "",
      paiseToRupees(ve["debit_paise"]),
      paiseToRupees(ve["credit_paise"]),
      String(ve["narration"] ?? ""),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(veRows), "Voucher_Entries");

  // Trial Balance (computed)
  const tb = new Map<string, { dr: number; cr: number }>();
  for (const ve of b.voucher_entries) {
    const lid = String(ve["ledger_id"] ?? "");
    const cur = tb.get(lid) ?? { dr: 0, cr: 0 };
    cur.dr += paiseToRupees(ve["debit_paise"]);
    cur.cr += paiseToRupees(ve["credit_paise"]);
    tb.set(lid, cur);
  }
  // Add openings
  for (const l of b.ledgers) {
    const lid = String(l["id"] ?? "");
    const ob = paiseToRupees(l["opening_balance_paise"]);
    if (ob === 0) continue;
    const cur = tb.get(lid) ?? { dr: 0, cr: 0 };
    if (l["opening_balance_is_debit"]) cur.dr += ob;
    else cur.cr += ob;
    tb.set(lid, cur);
  }
  let totalDr = 0;
  let totalCr = 0;
  const tbRows: (string | number)[][] = [["Ledger", "Debit (₹)", "Credit (₹)"]];
  for (const [lid, v] of tb) {
    const net = v.dr - v.cr;
    const dr = net > 0 ? net : 0;
    const cr = net < 0 ? -net : 0;
    totalDr += dr;
    totalCr += cr;
    tbRows.push([ledgerName.get(lid) ?? lid, dr, cr]);
  }
  tbRows.push(["TOTAL", totalDr, totalCr]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tbRows), "Trial_Balance");

  // Bill allocations
  const baRows = [
    ["Invoice #", "Payment #", "Ledger", "Amount (₹)"],
    ...b.bill_allocations.map((ba) => [
      vNumber.get(String(ba["invoice_voucher_id"] ?? "")) ?? "",
      vNumber.get(String(ba["payment_voucher_id"] ?? "")) ?? "",
      ledgerName.get(String(ba["ledger_id"] ?? "")) ?? "",
      paiseToRupees(ba["amount_paise"]),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baRows), "Bill_Allocations");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

// ---------- Public API ----------
export interface MirrorResult {
  jsonFile: string;
  xlsxFile: string;
  desktopJsonPath?: string;
  desktopXlsxPath?: string;
  isDesktop: boolean;
}

const LAST_MIRROR_KEY = "ym_last_local_mirror:";

export function getLastLocalMirror(companyId: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(LAST_MIRROR_KEY + companyId); } catch { return null; }
}

/**
 * Build a snapshot for the company and write both JSON + XLSX.
 * - Desktop: silently to Documents/YourMehtaji/Exports/<Company>/{backups,latest}/
 * - Browser: triggers two downloads
 */
export async function writeLocalMirror(
  companyId: string,
  companyName: string,
): Promise<MirrorResult> {
  const backup = await buildCompanyBackup(companyId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safe = safeName(companyName);
  const jsonFile = `${safe}_${stamp}.json`;
  const xlsxFile = `${safe}_${stamp}.xlsx`;
  const latestJson = `${safe}_latest.json`;
  const latestXlsx = `${safe}_latest.xlsx`;

  const jsonStr = JSON.stringify(backup, null, 2);
  const xlsxBytes = buildWorkbook(backup, companyName);

  const api = electron();
  if (api) {
    const [j1, x1, j2, x2] = await Promise.all([
      api.saveCompanyFile(companyName, "backups", jsonFile, jsonStr),
      api.saveCompanyFile(companyName, "backups", xlsxFile, xlsxBytes),
      api.saveCompanyFile(companyName, "latest", latestJson, jsonStr),
      api.saveCompanyFile(companyName, "latest", latestXlsx, xlsxBytes),
    ]);
    if (!j1.ok || !x1.ok || !j2.ok || !x2.ok) {
      const err = j1.error || x1.error || j2.error || x2.error || "Unknown error";
      throw new Error(`Local save failed: ${err}`);
    }
    try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
    return {
      jsonFile, xlsxFile,
      desktopJsonPath: j1.path,
      desktopXlsxPath: x1.path,
      isDesktop: true,
    };
  }

  // Browser fallback — two downloads.
  browserDownload(jsonFile, jsonStr, "application/json");
  browserDownload(xlsxFile, xlsxBytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  try { localStorage.setItem(LAST_MIRROR_KEY + companyId, new Date().toISOString()); } catch { /* ignore */ }
  return { jsonFile, xlsxFile, isDesktop: false };
}
