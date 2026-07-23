// A4 GST Tax Invoice PDF generator — ink-light layout adopted from the
// customer-approved ABC Enterprises sample. Six-column item table, HSN-wise
// tax classification block, right-side totals box. Hairline rules only.
import type jsPDFType from "jspdf";
import type autoTableType from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { amountInWords, formatINR } from "@/lib/money";
import { saveExport } from "@/lib/desktop-save";
import { exportCurrencySymbol } from "@/lib/export-format";
import {
  withCacheFallback,
  readCompanies,
  readCompanySettings,
  readVoucherItems,
  readLedgers,
  readItems,
} from "@/lib/offline/cache-read";
import { offlineDb } from "@/lib/offline/db";

const r = (paise: number) => (paise / 100).toFixed(2);
const rIN = (paise: number) => formatINR(paise, { symbol: false });

async function loadJsPdf(): Promise<{ jsPDF: typeof jsPDFType; autoTable: typeof autoTableType }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

interface CompanyRow {
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  state: string | null;
  state_code: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
}

interface SettingsRow {
  invoice_footer_note: string | null;
  invoice_terms: string | null;
  show_bank_details: boolean;
  show_signatory: boolean;
}

interface PartyRow {
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  state: string | null;
  state_code: string | null;
  phone: string | null;
}

interface VoucherRow {
  voucher_number: string;
  voucher_date: string;
  voucher_type: string;
  reference_no: string | null;
  narration: string | null;
  is_interstate: boolean;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  place_of_supply_code: string | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
}

interface ItemRow {
  line_no: number;
  description: string | null;
  qty: number;
  rate_paise: number;
  discount_paise: number;
  taxable_paise: number;
  gst_rate: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  amount_paise: number;
  items: { name: string; hsn_code: string | null; unit: string } | null;
}

const TYPE_TITLE: Record<string, string> = {
  sales: "Tax Invoice",
  purchase: "Purchase Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

export async function downloadInvoicePdf(voucherId: string, companyId: string): Promise<void> {
  type Bundle = {
    v: VoucherRow & { ledgers: PartyRow | null };
    items: ItemRow[];
    company: CompanyRow;
    settings: SettingsRow;
  };
  const defaultSettings: SettingsRow = {
    invoice_footer_note: null,
    invoice_terms: null,
    show_bank_details: true,
    show_signatory: true,
  };

  const bundle = await withCacheFallback<Bundle>(
    async () => {
      const [voucherQ, itemsQ, companyQ, settingsQ] = await Promise.all([
        supabase
          .from("vouchers")
          .select(
            "voucher_number, voucher_date, voucher_type, reference_no, narration, is_interstate, subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, place_of_supply_code, vendor_invoice_no, vendor_invoice_date, party_ledger_id, ledgers:party_ledger_id(name, gstin, pan, address, state, state_code, phone)",
          )
          .eq("id", voucherId)
          .single(),
        supabase
          .from("voucher_items")
          .select(
            "line_no, description, qty, rate_paise, discount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, amount_paise, items:item_id(name, hsn_code, unit)",
          )
          .eq("voucher_id", voucherId)
          .order("line_no"),
        supabase
          .from("companies")
          .select(
            "name, gstin, pan, address, state, state_code, email, phone, logo_url, bank_name, bank_account_no, bank_ifsc, bank_branch",
          )
          .eq("id", companyId)
          .single(),
        supabase
          .from("company_settings")
          .select("invoice_footer_note, invoice_terms, show_bank_details, show_signatory")
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);
      if (voucherQ.error || !voucherQ.data) throw voucherQ.error || new Error("Voucher not found");
      return {
        v: voucherQ.data as VoucherRow & { ledgers: PartyRow | null },
        items: (itemsQ.data || []) as unknown as ItemRow[],
        company: (companyQ.data || {}) as CompanyRow,
        settings: (settingsQ.data as SettingsRow | null) || defaultSettings,
      };
    },
    async () => {
      const [voucherRaw, itemRows, ledgers, itemsMaster, companies, settings] = await Promise.all([
        offlineDb.cache_vouchers.get(voucherId) as Promise<any>,
        readVoucherItems(voucherId) as Promise<any[]>,
        readLedgers(companyId) as Promise<any[]>,
        readItems(companyId) as Promise<any[]>,
        readCompanies() as Promise<any[]>,
        readCompanySettings(companyId) as Promise<any>,
      ]);
      if (!voucherRaw) throw new Error("Voucher not available offline");
      const ledgerById = new Map(ledgers.map((l) => [String(l.id), l]));
      const itemById = new Map(itemsMaster.map((i) => [String(i.id), i]));
      const party = voucherRaw.party_ledger_id
        ? ledgerById.get(String(voucherRaw.party_ledger_id)) ?? null
        : null;
      const items: ItemRow[] = (itemRows || [])
        .sort((a, b) => (Number(a.line_no ?? 0) - Number(b.line_no ?? 0)))
        .map((it) => ({
          ...it,
          items: it.item_id
            ? (() => {
                const m = itemById.get(String(it.item_id));
                return m ? { name: m.name, hsn_code: m.hsn_code ?? null, unit: m.unit } : null;
              })()
            : null,
        })) as ItemRow[];
      const company = (companies.find((c) => String(c.id) === String(companyId)) ?? {}) as CompanyRow;
      return {
        v: { ...voucherRaw, ledgers: (party as PartyRow | null) ?? null } as VoucherRow & { ledgers: PartyRow | null },
        items,
        company,
        settings: (settings as SettingsRow | null) || defaultSettings,
      };
    },
  );

  const v = bundle.v;
  const items = bundle.items;
  const company = bundle.company;
  const settings = bundle.settings;
  const party = v.ledgers;
  const isInter = v.is_interstate;
  const curr = exportCurrencySymbol();

  const { jsPDF, autoTable } = await loadJsPdf();
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 32;
  const contentW = pageW - M * 2;
  const HAIR = 0.5;

  doc.setLineWidth(HAIR);
  doc.setDrawColor(60);
  doc.setTextColor(0);

  // ── Outer frame ──────────────────────────────────────────────────────────
  doc.rect(M, M, contentW, pageH - M * 2);

  // ── Header block ─────────────────────────────────────────────────────────
  let y = M + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(company.name || "", pageW / 2, y, { align: "center" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (company.address) {
    const lines = doc.splitTextToSize(company.address, contentW - 20);
    doc.text(lines, pageW / 2, y, { align: "center" });
    y += lines.length * 11;
  }
  if (company.gstin) {
    doc.text(`GSTIN/UIN: ${company.gstin}`, pageW / 2, y, { align: "center" });
    y += 11;
  }
  if (company.state) {
    doc.text(
      `State Name: ${company.state}${company.state_code ? `, Code: ${company.state_code}` : ""}`,
      pageW / 2,
      y,
      { align: "center" },
    );
    y += 11;
  }

  y += 4;
  doc.line(M, y, pageW - M, y);
  y += 14;

  // Invoice No / Date row
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Invoice No: ${v.voucher_number}`, M + 8, y);
  doc.text(`Date: ${formatDate(v.voucher_date)}`, pageW - M - 8, y, { align: "right" });
  y += 8;
  doc.line(M, y, pageW - M, y);
  y += 12;

  // Document title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text((TYPE_TITLE[v.voucher_type] ?? "Invoice").toUpperCase(), pageW / 2, y, { align: "center" });
  y += 12;

  // ── Bill To box ──────────────────────────────────────────────────────────
  const billBoxX = M + 10;
  const billBoxW = contentW - 20;
  const billLines: string[] = [];
  if (party?.address) billLines.push(...doc.splitTextToSize(party.address, billBoxW - 16));
  if (party?.gstin) billLines.push(`GSTIN/UIN: ${party.gstin}`);
  if (party?.state)
    billLines.push(`State Name: ${party.state}${party.state_code ? `, Code: ${party.state_code}` : ""}`);
  if (v.place_of_supply_code) billLines.push(`Place of Supply: ${v.place_of_supply_code}`);

  const billBoxH = 14 + 12 + billLines.length * 11 + 8;
  doc.rect(billBoxX, y, billBoxW, billBoxH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Bill To:", billBoxX + 8, y + 12);
  doc.setFontSize(10);
  doc.text((party?.name ?? "Cash Sale").toUpperCase(), billBoxX + 8, y + 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let by = y + 36;
  for (const ln of billLines) {
    doc.text(ln, billBoxX + 8, by);
    by += 11;
  }
  y += billBoxH + 10;

  // ── Items table ──────────────────────────────────────────────────────────
  const head = [["Sr.\nNo.", "Description of Goods", "HSN/SAC", "Quantity", `Rate\n(${curr})`, `Amount\n(${curr})`]];
  const body = items.map((it, i) => [
    String(i + 1),
    (it.items?.name ?? "") + (it.description ? `\n${it.description}` : ""),
    it.items?.hsn_code ?? "—",
    `${Number(it.qty).toLocaleString("en-IN")}\n${it.items?.unit ?? ""}`,
    rIN(it.rate_paise),
    rIN(it.amount_paise),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: M + 10, right: M + 10 },
    head,
    body,
    theme: "grid",
    styles: {
      fontSize: 8.5,
      cellPadding: 4,
      lineColor: [60, 60, 60],
      lineWidth: HAIR,
      textColor: 0,
      valign: "top",
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 9,
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 32 },
      1: { halign: "left", cellWidth: "auto" },
      2: { halign: "center", cellWidth: 60 },
      3: { halign: "center", cellWidth: 62 },
      4: { halign: "right", cellWidth: 62 },
      5: { halign: "right", cellWidth: 72 },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursorY = (doc as any).lastAutoTable.finalY;

  // Subtotal row (right-aligned "Total" spanning last two columns)
  const stH = 18;
  const tableRight = pageW - M - 10;
  const tableLeft = M + 10;
  doc.rect(tableLeft, cursorY, tableRight - tableLeft, stH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Total", tableRight - 72 - 8, cursorY + 12, { align: "right" });
  doc.text(rIN(v.subtotal_paise), tableRight - 6, cursorY + 12, { align: "right" });
  cursorY += stH + 10;

  // ── HSN-wise Tax Classification ──────────────────────────────────────────
  const hsnMap = new Map<
    string,
    { taxable: number; cgst: number; sgst: number; igst: number; rate: number }
  >();
  for (const it of items) {
    const key = it.items?.hsn_code || "—";
    const cur = hsnMap.get(key) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0, rate: it.gst_rate };
    cur.taxable += it.taxable_paise;
    cur.cgst += it.cgst_paise;
    cur.sgst += it.sgst_paise;
    cur.igst += it.igst_paise;
    cur.rate = it.gst_rate;
    hsnMap.set(key, cur);
  }
  const hsnRows = Array.from(hsnMap.entries());

  const taxHead = isInter
    ? [["HSN/SAC", `Taxable\nValue (${curr})`, `IGST %`, `IGST\nAmount (${curr})`]]
    : [["HSN/SAC", `Taxable\nValue (${curr})`, `CGST %`, `CGST\nAmount (${curr})`, `SGST %`, `SGST\nAmount (${curr})`]];

  const taxBody = hsnRows.map(([hsn, s]) =>
    isInter
      ? [hsn, rIN(s.taxable), `${s.rate}%`, rIN(s.igst)]
      : [hsn, rIN(s.taxable), `${s.rate / 2}%`, rIN(s.cgst), `${s.rate / 2}%`, rIN(s.sgst)],
  );

  const totalRow = isInter
    ? ["Total", rIN(v.subtotal_paise), "", rIN(v.igst_paise)]
    : ["Total", rIN(v.subtotal_paise), "", rIN(v.cgst_paise), "", rIN(v.sgst_paise)];
  taxBody.push(totalRow);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: M + 10, right: M + 10 },
    head: taxHead,
    body: taxBody,
    theme: "grid",
    styles: {
      fontSize: 8.5,
      cellPadding: 4,
      lineColor: [60, 60, 60],
      lineWidth: HAIR,
      textColor: 0,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      fontSize: 9,
    },
    columnStyles: isInter
      ? { 0: { halign: "left" }, 1: { halign: "right" }, 2: { halign: "center" }, 3: { halign: "right" } }
      : {
          0: { halign: "left" },
          1: { halign: "right" },
          2: { halign: "center" },
          3: { halign: "right" },
          4: { halign: "center" },
          5: { halign: "right" },
        },
    didParseCell: (data) => {
      if (data.row.index === taxBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [250, 250, 250];
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = (doc as any).lastAutoTable.finalY + 12;

  // ── Total Invoice Value box (right) + Amount in words (left) ────────────
  const totalsW = 260;
  const totalsX = pageW - M - 10 - totalsW;
  const totalsRows: [string, string][] = [["Taxable Value", rIN(v.subtotal_paise)]];
  if (isInter) totalsRows.push([`Add: IGST`, rIN(v.igst_paise)]);
  else {
    totalsRows.push([`Add: CGST`, rIN(v.cgst_paise)]);
    totalsRows.push([`Add: SGST`, rIN(v.sgst_paise)]);
  }
  if (v.round_off_paise) totalsRows.push(["Round Off", rIN(v.round_off_paise)]);

  const lh = 14;
  const totalsH = totalsRows.length * lh + lh + 8;
  doc.rect(totalsX, cursorY, totalsW, totalsH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL INVOICE VALUE", totalsX + totalsW / 2, cursorY + 12, { align: "center" });
  doc.line(totalsX, cursorY + 16, totalsX + totalsW, cursorY + 16);

  doc.setFont("helvetica", "normal");
  totalsRows.forEach(([k, val], i) => {
    const yy = cursorY + 16 + lh + i * lh - 2;
    doc.text(k, totalsX + 8, yy);
    doc.text(`${curr} ${val}`, totalsX + totalsW - 8, yy, { align: "right" });
  });
  const grandY = cursorY + 16 + lh + totalsRows.length * lh - 2;
  doc.line(totalsX, grandY - 10, totalsX + totalsW, grandY - 10);
  doc.setFont("helvetica", "bold");
  doc.text("Total Invoice Amount", totalsX + 8, grandY);
  doc.text(`${curr} ${rIN(v.total_paise)}`, totalsX + totalsW - 8, grandY, { align: "right" });

  // Amount in words (left of totals box)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Amount Chargeable (in words):", M + 10, cursorY + 12);
  doc.setFont("helvetica", "normal");
  const wordsW = totalsX - (M + 10) - 12;
  const words = doc.splitTextToSize(`${amountInWords(v.total_paise)} Only`, wordsW);
  doc.text(words, M + 10, cursorY + 26);

  cursorY += Math.max(totalsH, 26 + words.length * 11) + 14;

  // ── Bank details ────────────────────────────────────────────────────────
  if (settings.show_bank_details && (company.bank_name || company.bank_account_no)) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Bank Details:", M + 10, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    let by2 = cursorY + 12;
    if (company.bank_name) { doc.text(`Bank: ${company.bank_name}`, M + 10, by2); by2 += 10; }
    if (company.bank_account_no) { doc.text(`A/c No: ${company.bank_account_no}`, M + 10, by2); by2 += 10; }
    if (company.bank_ifsc) { doc.text(`IFSC: ${company.bank_ifsc}`, M + 10, by2); by2 += 10; }
    if (company.bank_branch) { doc.text(`Branch: ${company.bank_branch}`, M + 10, by2); by2 += 10; }
    cursorY = by2 + 4;
  }

  // Terms / narration
  if (settings.invoice_terms) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Terms:", M + 10, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const tlines = doc.splitTextToSize(settings.invoice_terms, contentW - 200);
    doc.text(tlines, M + 10 + 36, cursorY);
    cursorY += Math.max(12, tlines.length * 10 + 4);
  }
  if (v.narration) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Narration:", M + 10, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const nlines = doc.splitTextToSize(v.narration, contentW - 200);
    doc.text(nlines, M + 10 + 50, cursorY);
    cursorY += Math.max(12, nlines.length * 10 + 4);
  }

  // System-generated line
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text("This is a system-generated invoice.", M + 10, pageH - M - 50);
  doc.setTextColor(0);

  // Signatory (right)
  if (settings.show_signatory) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const sx = pageW - M - 180;
    const sy = pageH - M - 40;
    doc.text(`For ${company.name}`, sx, sy);
    doc.line(sx, sy + 20, sx + 160, sy + 20);
    doc.setFont("helvetica", "bold");
    doc.text("Authorised Signatory", sx, sy + 32);
  }

  // Footer note
  if (settings.invoice_footer_note) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(settings.invoice_footer_note, pageW / 2, pageH - M - 8, { align: "center" });
    doc.setTextColor(0);
  }

  const fileName = `${TYPE_TITLE[v.voucher_type] || "invoice"}-${v.voucher_number}.pdf`;
  const { stampWatermarkIfUnlicensed } = await import("./license/pdf-watermark");
  await stampWatermarkIfUnlicensed(doc);
  const buf = doc.output("arraybuffer");
  await saveExport({
    subFolder: "Invoices",
    fileName,
    contents: buf,
    mime: "application/pdf",
  });
}

function formatDate(iso: string): string {
  // Turn YYYY-MM-DD into DD-MM-YYYY for Indian invoice convention.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
