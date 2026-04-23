// A4 GST Tax Invoice PDF generator using jsPDF + autotable.
// Pulls company, party, items and totals from Supabase.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { amountInWords, formatINR } from "@/lib/money";
import { saveExport } from "@/lib/desktop-save";

const r = (paise: number) => (paise / 100).toFixed(2);

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

async function loadLogo(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    return null;
  }
}

export async function downloadInvoicePdf(voucherId: string, companyId: string): Promise<void> {
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
  const v = voucherQ.data as VoucherRow & { ledgers: PartyRow | null };
  const items = (itemsQ.data || []) as unknown as ItemRow[];
  const company = (companyQ.data || {}) as CompanyRow;
  const settings: SettingsRow = (settingsQ.data as SettingsRow | null) || {
    invoice_footer_note: null,
    invoice_terms: null,
    show_bank_details: true,
    show_signatory: true,
  };
  const party = v.ledgers;

  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 32;
  let y = M;

  // Header band
  doc.setFillColor(26, 39, 68);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(TYPE_TITLE[v.voucher_type] ?? "Invoice", pageW - M, 28, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Invoice #: ${v.voucher_number}`, pageW - M, 44, { align: "right" });
  doc.text(`Date: ${v.voucher_date}`, pageW - M, 56, { align: "right" });

  // Logo
  let logo: { data: string; w: number; h: number } | null = null;
  if (company.logo_url) logo = await loadLogo(company.logo_url);
  if (logo) {
    const maxH = 40;
    const ratio = logo.w / logo.h;
    const h = Math.min(maxH, logo.h);
    const w = h * ratio;
    try {
      doc.addImage(logo.data, "PNG", M, 15, w, h);
    } catch {
      /* ignore unsupported format */
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(company.name, M, 32);
  }

  doc.setTextColor(0, 0, 0);
  y = 90;

  // Company block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(company.name, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  y += 12;
  if (company.address) {
    const lines = doc.splitTextToSize(company.address, 280);
    doc.text(lines, M, y);
    y += lines.length * 10;
  }
  if (company.state) {
    doc.text(`State: ${company.state}${company.state_code ? ` (${company.state_code})` : ""}`, M, y);
    y += 10;
  }
  const contactBits: string[] = [];
  if (company.phone) contactBits.push(`Ph: ${company.phone}`);
  if (company.email) contactBits.push(company.email);
  if (contactBits.length) {
    doc.text(contactBits.join(" · "), M, y);
    y += 10;
  }
  if (company.gstin) {
    doc.setFont("helvetica", "bold");
    doc.text(`GSTIN: ${company.gstin}`, M, y);
    y += 10;
  }
  if (company.pan) {
    doc.setFont("helvetica", "normal");
    doc.text(`PAN: ${company.pan}`, M, y);
    y += 10;
  }

  // Bill-to block (right side)
  let yR = 90;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Bill To:", pageW - M - 240, yR);
  yR += 12;
  doc.setFontSize(10);
  doc.text(party?.name ?? "Cash Sale", pageW - M - 240, yR);
  yR += 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (party?.address) {
    const lines = doc.splitTextToSize(party.address, 240);
    doc.text(lines, pageW - M - 240, yR);
    yR += lines.length * 10;
  }
  if (party?.state) {
    doc.text(`State: ${party.state}${party.state_code ? ` (${party.state_code})` : ""}`, pageW - M - 240, yR);
    yR += 10;
  }
  if (party?.gstin) {
    doc.setFont("helvetica", "bold");
    doc.text(`GSTIN: ${party.gstin}`, pageW - M - 240, yR);
    yR += 10;
  }
  if (v.place_of_supply_code) {
    doc.setFont("helvetica", "normal");
    doc.text(`Place of Supply: ${v.place_of_supply_code}`, pageW - M - 240, yR);
    yR += 10;
  }
  if (v.reference_no) {
    doc.text(`Ref: ${v.reference_no}`, pageW - M - 240, yR);
    yR += 10;
  }
  if (v.vendor_invoice_no) {
    doc.text(`Vendor Inv: ${v.vendor_invoice_no} ${v.vendor_invoice_date ?? ""}`, pageW - M - 240, yR);
    yR += 10;
  }

  const startY = Math.max(y, yR) + 10;
  const isInter = v.is_interstate;

  // Line items table
  const head = isInter
    ? [["#", "Item / Description", "HSN", "Qty", "Rate", "Disc", "Taxable", "IGST %", "IGST", "Amount"]]
    : [["#", "Item / Description", "HSN", "Qty", "Rate", "Disc", "Taxable", "GST %", "CGST", "SGST", "Amount"]];

  const body = items.map((it, i) => {
    const desc = it.items?.name + (it.description ? `\n${it.description}` : "");
    const base = [
      String(i + 1),
      desc,
      it.items?.hsn_code ?? "—",
      `${it.qty} ${it.items?.unit ?? ""}`,
      r(it.rate_paise),
      r(it.discount_paise),
      r(it.taxable_paise),
    ];
    if (isInter) return [...base, `${it.gst_rate}%`, r(it.igst_paise), r(it.amount_paise)];
    return [...base, `${it.gst_rate}%`, r(it.cgst_paise), r(it.sgst_paise), r(it.amount_paise)];
  });

  autoTable(doc, {
    startY,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontStyle: "bold" },
    columnStyles: isInter
      ? { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } }
      : { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" }, 10: { halign: "right" } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursorY = (doc as any).lastAutoTable.finalY + 14;

  // Totals box (right)
  const boxX = pageW - M - 220;
  const boxW = 220;
  const lh = 14;
  const totals: [string, string][] = [
    ["Subtotal", r(v.subtotal_paise)],
  ];
  if (isInter) totals.push(["IGST", r(v.igst_paise)]);
  else {
    totals.push(["CGST", r(v.cgst_paise)]);
    totals.push(["SGST", r(v.sgst_paise)]);
  }
  if (v.round_off_paise) totals.push(["Round Off", r(v.round_off_paise)]);
  totals.push(["Grand Total", r(v.total_paise)]);

  doc.setDrawColor(200);
  doc.rect(boxX, cursorY, boxW, totals.length * lh + 6);
  doc.setFontSize(9);
  totals.forEach(([k, val], i) => {
    const yy = cursorY + 14 + i * lh;
    if (i === totals.length - 1) {
      doc.setFont("helvetica", "bold");
      doc.setFillColor(245, 245, 245);
      doc.rect(boxX, yy - 11, boxW, lh, "F");
    } else {
      doc.setFont("helvetica", "normal");
    }
    doc.text(k, boxX + 8, yy);
    doc.text(`Rs. ${val}`, boxX + boxW - 8, yy, { align: "right" });
  });

  // Amount in words (left)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Amount in words:", M, cursorY + 14);
  doc.setFont("helvetica", "normal");
  const words = doc.splitTextToSize(amountInWords(v.total_paise), pageW - M - boxW - 40);
  doc.text(words, M, cursorY + 28);

  cursorY = cursorY + Math.max(totals.length * lh + 16, 28 + words.length * 11) + 12;

  // Bank details + terms + signatory
  if (settings.show_bank_details && (company.bank_name || company.bank_account_no)) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Bank Details:", M, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    let by = cursorY + 12;
    if (company.bank_name) { doc.text(`Bank: ${company.bank_name}`, M, by); by += 10; }
    if (company.bank_account_no) { doc.text(`A/c No: ${company.bank_account_no}`, M, by); by += 10; }
    if (company.bank_ifsc) { doc.text(`IFSC: ${company.bank_ifsc}`, M, by); by += 10; }
    if (company.bank_branch) { doc.text(`Branch: ${company.bank_branch}`, M, by); by += 10; }
    cursorY = by + 4;
  }

  if (settings.invoice_terms) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Terms & Conditions:", M, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const tlines = doc.splitTextToSize(settings.invoice_terms, pageW - M * 2 - 180);
    doc.text(tlines, M, cursorY + 12);
    cursorY += 12 + tlines.length * 10 + 6;
  }

  if (v.narration) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Narration:", M, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const nlines = doc.splitTextToSize(v.narration, pageW - M * 2 - 180);
    doc.text(nlines, M, cursorY + 12);
    cursorY += 12 + nlines.length * 10 + 6;
  }

  if (settings.show_signatory) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const sx = pageW - M - 160;
    const sy = pageH - 60;
    doc.text(`For ${company.name}`, sx, sy);
    doc.line(sx, sy + 28, sx + 150, sy + 28);
    doc.text("Authorised Signatory", sx, sy + 40);
  }

  if (settings.invoice_footer_note) {
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(settings.invoice_footer_note, pageW / 2, pageH - 20, { align: "center" });
    doc.setTextColor(0);
  }

  // suppress unused-warning helper
  void formatINR;

  const fileName = `${TYPE_TITLE[v.voucher_type] || "invoice"}-${v.voucher_number}.pdf`;
  const buf = doc.output("arraybuffer");
  await saveExport({
    subFolder: "Invoices",
    fileName,
    contents: buf,
    mime: "application/pdf",
  });
}
