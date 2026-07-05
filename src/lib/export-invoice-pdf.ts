// Export Invoice PDF generator for agricultural exports.
// Separate template from the domestic Tax Invoice. Pulls voucher + line items
// + company + party + voucher_export_details, and prints a dual-currency
// (foreign currency + INR equivalent) invoice with all standard export header
// fields, agri-specific block and the LUT / IGST declaration.
import type jsPDFType from "jspdf";
import type autoTableType from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { saveExport } from "@/lib/desktop-save";
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
const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

async function loadJsPdf(): Promise<{ jsPDF: typeof jsPDFType; autoTable: typeof autoTableType }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

const EXPORT_TYPE_LABEL: Record<string, string> = {
  lut_wop: "Export under LUT / Bond — WITHOUT payment of IGST",
  with_igst: "Export WITH payment of IGST (refund claimable)",
  sez_wp: "Supply to SEZ — WITH payment of IGST",
  sez_wop: "Supply to SEZ — WITHOUT payment of IGST (under LUT)",
  deemed: "Deemed Export",
};

const DEFAULT_DECL: Record<string, string> = {
  lut_wop:
    "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX.",
  with_igst:
    "SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX. REFUND OF IGST PAID ON EXPORT GOODS IS CLAIMED.",
  sez_wp: "SUPPLY MEANT FOR SEZ ON PAYMENT OF INTEGRATED TAX.",
  sez_wop: "SUPPLY MEANT FOR SEZ UNDER LUT WITHOUT PAYMENT OF INTEGRATED TAX.",
  deemed: "DEEMED EXPORT SUPPLY UNDER GST.",
};

export async function downloadExportInvoicePdf(voucherId: string, companyId: string): Promise<void> {
  const [voucherQ, itemsQ, companyQ, exportQ, settingsQ] = await Promise.all([
    supabase
      .from("vouchers")
      .select(
        "voucher_number, voucher_date, voucher_type, reference_no, narration, subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, shipping_bill_no, shipping_bill_date, port_code, ledgers:party_ledger_id(name, gstin, address, state, state_code, phone)",
      )
      .eq("id", voucherId)
      .single(),
    supabase
      .from("voucher_items")
      .select(
        "line_no, description, qty, rate_paise, discount_paise, taxable_paise, gst_rate, igst_paise, amount_paise, items:item_id(name, hsn_code, unit)",
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
    supabase.from("voucher_export_details").select("*").eq("voucher_id", voucherId).maybeSingle(),
    supabase
      .from("company_settings")
      .select("invoice_footer_note, show_bank_details, show_signatory")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (voucherQ.error || !voucherQ.data) throw voucherQ.error || new Error("Voucher not found");
  const v = voucherQ.data as any;
  const items = (itemsQ.data || []) as any[];
  const company = (companyQ.data || {}) as any;
  const ed = (exportQ.data || {}) as any;
  const settings = (settingsQ.data || { show_bank_details: true, show_signatory: true, invoice_footer_note: null }) as any;
  const party = v.ledgers || {};

  const ccy = (ed.currency_code as string) || "USD";
  const fx = Number(ed.fx_rate) || 1; // INR per 1 unit of ccy
  const toFx = (paise: number) => paise / 100 / fx;

  const { jsPDF, autoTable } = await loadJsPdf();
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 28;

  // Header band
  doc.setFillColor(15, 58, 78);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("EXPORT INVOICE", pageW / 2, 28, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(EXPORT_TYPE_LABEL[ed.export_type] || EXPORT_TYPE_LABEL.lut_wop, pageW / 2, 44, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Invoice No: ${v.voucher_number}   Date: ${v.voucher_date}`, pageW / 2, 56, { align: "center" });

  doc.setTextColor(0);

  // Exporter / Consignee / Buyer grid
  const colW = (pageW - M * 2 - 12) / 2;
  let y = 78;

  const block = (x: number, yy: number, w: number, title: string, lines: string[]) => {
    doc.setDrawColor(180);
    const h = 14 + lines.length * 10 + 6;
    doc.rect(x, yy, w, h);
    doc.setFillColor(238, 242, 245);
    doc.rect(x, yy, w, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(title, x + 5, yy + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    lines.forEach((l, i) => doc.text(l, x + 5, yy + 24 + i * 10));
    return h;
  };

  const exporterLines = [
    company.name,
    ...(company.address ? doc.splitTextToSize(company.address, colW - 10) : []),
    company.state ? `State: ${company.state}${company.state_code ? ` (${company.state_code})` : ""}` : "",
    company.gstin ? `GSTIN: ${company.gstin}` : "",
    company.pan ? `PAN: ${company.pan}` : "",
    ed.iec_no ? `IEC: ${ed.iec_no}` : "",
    ed.lut_no ? `LUT No: ${ed.lut_no}${ed.lut_date ? ` dt ${ed.lut_date}` : ""}` : "",
  ].filter(Boolean);

  const consigneeLines = [
    ed.consignee_name || party.name || "—",
    ...(ed.consignee_address ? doc.splitTextToSize(ed.consignee_address, colW - 10) : party.address ? doc.splitTextToSize(party.address, colW - 10) : []),
    ed.consignee_country ? `Country: ${ed.consignee_country}` : "",
  ].filter(Boolean);

  const buyerLines = ed.buyer_name
    ? [
        ed.buyer_name,
        ...(ed.buyer_address ? doc.splitTextToSize(ed.buyer_address, colW - 10) : []),
        ed.buyer_country ? `Country: ${ed.buyer_country}` : "",
      ].filter(Boolean)
    : ["Same as Consignee"];

  const h1 = block(M, y, colW, "Exporter", exporterLines);
  const h2 = block(M + colW + 12, y, colW, "Consignee", consigneeLines);
  y += Math.max(h1, h2) + 6;

  const refLines = [
    v.reference_no ? `Buyer's Order / Ref: ${v.reference_no}` : "",
    ed.payment_terms ? `Payment Terms: ${ed.payment_terms}` : "",
    ed.incoterms ? `INCOTERMS: ${ed.incoterms}` : "",
    `Currency: ${ccy}   FX Rate: 1 ${ccy} = ₹ ${fmt(fx, 4)}${ed.fx_rate_source ? `  (${ed.fx_rate_source})` : ""}`,
  ].filter(Boolean);

  const h3 = block(M, y, colW, "Buyer (if other than Consignee)", buyerLines);
  const h4 = block(M + colW + 12, y, colW, "Reference / Terms", refLines);
  y += Math.max(h3, h4) + 6;

  // Shipment block (full width)
  const ship: [string, string][] = [
    ["Pre-Carriage By", ed.pre_carriage_by || "—"],
    ["Place of Receipt", ed.place_of_receipt || "—"],
    ["Vessel / Flight No", ed.vessel_flight_no || "—"],
    ["Port of Loading", ed.port_of_loading || v.port_code || "—"],
    ["Port of Discharge", ed.port_of_discharge || "—"],
    ["Final Destination", ed.final_destination || "—"],
    ["Country of Origin", ed.country_of_origin || "India"],
    ["Country of Destination", ed.country_of_destination || ed.consignee_country || "—"],
    ["Container No", ed.container_no || "—"],
    ["Marks & Nos", ed.marks_nos || "—"],
    ["Shipping Bill No / Date", v.shipping_bill_no ? `${v.shipping_bill_no}${v.shipping_bill_date ? ` / ${v.shipping_bill_date}` : ""}` : "—"],
    ["Packages", `${ed.no_of_packages || "—"} ${ed.kind_of_packages || ""}`.trim()],
    ["Net Weight (kg)", ed.net_weight_kg != null ? fmt(Number(ed.net_weight_kg), 3) : "—"],
    ["Gross Weight (kg)", ed.gross_weight_kg != null ? fmt(Number(ed.gross_weight_kg), 3) : "—"],
  ];
  autoTable(doc, {
    startY: y,
    head: [["Shipment Details", "", "", ""]],
    body: chunk2cols(ship),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 58, 78], textColor: 255 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 110 }, 1: { cellWidth: 170 }, 2: { fontStyle: "bold", cellWidth: 110 }, 3: { cellWidth: "auto" } },
    theme: "grid",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // Agri-specific block (only if any field present)
  const agri: [string, string][] = [];
  if (ed.variety_grade) agri.push(["Variety / Grade", ed.variety_grade]);
  if (ed.crop_year) agri.push(["Crop Year", ed.crop_year]);
  if (ed.lot_batch_no) agri.push(["Lot / Batch No", ed.lot_batch_no]);
  if (ed.moisture_pct != null) agri.push(["Moisture %", `${ed.moisture_pct}`]);
  if (ed.packing_spec) agri.push(["Packing Spec", ed.packing_spec]);
  if (ed.fssai_no) agri.push(["FSSAI No", ed.fssai_no]);
  if (ed.apeda_rcmc_no) agri.push(["APEDA RCMC", ed.apeda_rcmc_no]);
  if (ed.phyto_cert_no) agri.push(["Phytosanitary Cert", ed.phyto_cert_no]);
  if (agri.length) {
    autoTable(doc, {
      startY: y,
      head: [["Agri-Product Details", "", "", ""]],
      body: chunk2cols(agri),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [15, 58, 78], textColor: 255 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 110 }, 1: { cellWidth: 170 }, 2: { fontStyle: "bold", cellWidth: 110 }, 3: { cellWidth: "auto" } },
      theme: "grid",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // Line items — dual currency
  const head = [[
    "#", "Description of Goods", "HSN", "Qty",
    `Rate (${ccy})`, `Amount (${ccy})`, "Rate (INR)", "Amount (INR)",
  ]];
  const body = items.map((it, i) => {
    const desc = (it.items?.name || "") + (it.description ? `\n${it.description}` : "");
    return [
      String(i + 1),
      desc,
      it.items?.hsn_code ?? "—",
      `${it.qty} ${it.items?.unit ?? ""}`,
      fmt(toFx(it.rate_paise), 4),
      fmt(toFx(it.taxable_paise), 2),
      r(it.rate_paise),
      r(it.taxable_paise),
    ];
  });
  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 58, 78], textColor: 255, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // Totals — dual currency
  const totalsBody: string[][] = [
    ["Taxable / FOB Value", fmt(toFx(v.subtotal_paise)), r(v.subtotal_paise)],
  ];
  if (ed.export_type === "with_igst" || ed.export_type === "sez_wp") {
    totalsBody.push(["IGST", fmt(toFx(v.igst_paise)), r(v.igst_paise)]);
  } else {
    totalsBody.push(["IGST", "NIL (LUT / Bond)", "NIL (LUT / Bond)"]);
  }
  if (v.round_off_paise) totalsBody.push(["Round Off", fmt(toFx(v.round_off_paise)), r(v.round_off_paise)]);
  totalsBody.push(["Invoice Total", fmt(toFx(v.total_paise)), r(v.total_paise)]);

  autoTable(doc, {
    startY: y,
    head: [["", `Amount (${ccy})`, "Amount (INR)"]],
    body: totalsBody,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [15, 58, 78], textColor: 255 },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" }, 2: { halign: "right" } },
    margin: { left: pageW / 2 - 20 },
    theme: "grid",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // Declaration
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Declaration:", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const decl = ed.declaration || DEFAULT_DECL[ed.export_type] || DEFAULT_DECL.lut_wop;
  const dl = doc.splitTextToSize(decl, pageW - M * 2);
  doc.text(dl, M, y + 12);
  y += 12 + dl.length * 10 + 4;

  if (ed.remarks) {
    doc.setFont("helvetica", "bold");
    doc.text("Remarks:", M, y);
    doc.setFont("helvetica", "normal");
    const rl = doc.splitTextToSize(ed.remarks, pageW - M * 2);
    doc.text(rl, M, y + 12);
    y += 12 + rl.length * 10 + 4;
  }

  // Bank
  if (settings.show_bank_details && (company.bank_name || company.bank_account_no)) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Bank Details (for foreign remittance):", M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    let by = y + 12;
    if (company.bank_name) { doc.text(`Bank: ${company.bank_name}`, M, by); by += 10; }
    if (company.bank_account_no) { doc.text(`A/c No: ${company.bank_account_no}`, M, by); by += 10; }
    if (company.bank_ifsc) { doc.text(`IFSC / SWIFT: ${company.bank_ifsc}`, M, by); by += 10; }
    if (company.bank_branch) { doc.text(`Branch: ${company.bank_branch}`, M, by); by += 10; }
    y = by + 4;
  }

  // Signatory
  if (settings.show_signatory) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const sx = pageW - M - 170;
    const sy = pageH - 70;
    doc.text(`For ${company.name}`, sx, sy);
    doc.line(sx, sy + 32, sx + 160, sy + 32);
    doc.text("Authorised Signatory", sx, sy + 44);
  }

  if (settings.invoice_footer_note) {
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(settings.invoice_footer_note, pageW / 2, pageH - 20, { align: "center" });
    doc.setTextColor(0);
  }

  const fileName = `Export-Invoice-${v.voucher_number}.pdf`;
  const buf = doc.output("arraybuffer");
  await saveExport({ subFolder: "Invoices", fileName, contents: buf, mime: "application/pdf" });
}

function chunk2cols(pairs: [string, string][]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1] || ["", ""];
    rows.push([a[0], a[1], b[0], b[1]]);
  }
  return rows;
}
