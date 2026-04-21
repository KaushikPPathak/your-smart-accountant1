// GST Returns builder — produces GSTR-1 and GSTR-3B in formats compliant with
// the GST Offline Tool (Excel) and the GSTN portal (JSON).
// All amounts handled in paise internally; converted to rupees (2dp) on output.

import { supabase } from "@/integrations/supabase/client";

const r = (paise: number): number => Number((paise / 100).toFixed(2));

// ───────────────────── Types ─────────────────────

export interface VoucherRow {
  id: string;
  voucher_date: string;
  voucher_number: string;
  voucher_type: string;
  is_interstate: boolean;
  place_of_supply_code: string | null;
  reference_no: string | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  reason: string | null;
  original_voucher_id: string | null;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: {
    name: string;
    gstin: string | null;
    state_code: string | null;
  } | null;
  voucher_items: {
    qty: number;
    rate_paise: number;
    taxable_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    gst_rate: number;
    items: { name: string; hsn_code: string | null; unit: string } | null;
  }[];
}

export interface CompanyMeta {
  gstin: string | null;
  state_code: string | null;
  name: string;
}

export interface BuiltGstr1 {
  meta: { gstin: string; fp: string; from: string; to: string };
  b2b: B2BInvoice[];
  b2cl: B2CLInvoice[];
  b2cs: B2CSGroup[];
  cdnr: CDNRInvoice[];
  cdnur: CDNURInvoice[];
  hsn: HSNRow[];
  docs: DocSummary[];
}

export interface B2BInvoice {
  ctin: string;
  inum: string;
  idt: string; // dd-mm-yyyy
  val: number;
  pos: string;
  rchrg: "N" | "Y";
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE";
  itms: TaxLine[];
}

export interface B2CLInvoice {
  inum: string;
  idt: string;
  val: number;
  pos: string;
  itms: TaxLine[];
}

export interface B2CSGroup {
  sply_ty: "INTRA" | "INTER";
  pos: string;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
  typ: "OE";
}

export interface CDNRInvoice {
  ctin: string;
  nt_num: string;
  nt_dt: string;
  ntty: "C" | "D";
  val: number;
  pos: string;
  rchrg: "N" | "Y";
  inv_typ: "R";
  itms: TaxLine[];
}

export interface CDNURInvoice {
  typ: "B2CL";
  nt_num: string;
  nt_dt: string;
  ntty: "C" | "D";
  val: number;
  pos: string;
  itms: TaxLine[];
}

export interface TaxLine {
  num: number;
  itm_det: { rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number };
}

export interface HSNRow {
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
  val: number;
}

export interface DocSummary {
  doc_typ: string;
  from: string;
  to: string;
  totnum: number;
  cancel: number;
  net_issue: number;
}

// ───────────────────── Date helpers ─────────────────────

export const fmtDDMMYYYY = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};

/** Returns "MMYYYY" period string used by GSTN (e.g. "042025" = Apr 2025) */
export const periodFP = (anyDateInPeriod: string): string => {
  const d = new Date(anyDateInPeriod);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${m}${d.getFullYear()}`;
};

export const monthRange = (yyyymm: string): { from: string; to: string } => {
  const [y, m] = yyyymm.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
};

export const quarterRange = (year: number, q: 1 | 2 | 3 | 4): { from: string; to: string } => {
  const startMonth = (q - 1) * 3 + 1; // 1,4,7,10
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
  const last = new Date(year, endMonth, 0).getDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
};

// ───────────────────── Loaders ─────────────────────

const SELECT = `id, voucher_date, voucher_number, voucher_type, is_interstate, place_of_supply_code,
reference_no, vendor_invoice_no, vendor_invoice_date, reason, original_voucher_id,
subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
ledgers:party_ledger_id(name, gstin, state_code),
voucher_items(qty, rate_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate,
items:item_id(name, hsn_code, unit))`;

export async function fetchVouchers(
  companyId: string,
  from: string,
  to: string,
  types: string[],
): Promise<VoucherRow[]> {
  const { data } = await supabase
    .from("vouchers")
    .select(SELECT)
    .eq("company_id", companyId)
    .in("voucher_type", types)
    .gte("voucher_date", from)
    .lte("voucher_date", to)
    .order("voucher_date", { ascending: true });
  return (data || []) as unknown as VoucherRow[];
}

export async function fetchCompanyMeta(companyId: string): Promise<CompanyMeta> {
  const { data } = await supabase
    .from("companies")
    .select("name, gstin, state_code")
    .eq("id", companyId)
    .maybeSingle();
  return {
    name: data?.name ?? "",
    gstin: data?.gstin ?? null,
    state_code: data?.state_code ?? null,
  };
}

// ───────────────────── GSTR-1 builder ─────────────────────

const B2CL_THRESHOLD_PAISE = 250000_00; // ₹2,50,000

const lineFromVoucherItems = (items: VoucherRow["voucher_items"]): TaxLine[] => {
  // Group lines by GST rate
  const byRate = new Map<number, { rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }>();
  let n = 0;
  for (const it of items) {
    const cur = byRate.get(it.gst_rate) ?? { rt: it.gst_rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    cur.txval += it.taxable_paise;
    cur.iamt += it.igst_paise;
    cur.camt += it.cgst_paise;
    cur.samt += it.sgst_paise;
    byRate.set(it.gst_rate, cur);
  }
  return Array.from(byRate.values()).map((g) => ({
    num: ++n,
    itm_det: { rt: g.rt, txval: r(g.txval), iamt: r(g.iamt), camt: r(g.camt), samt: r(g.samt), csamt: r(g.csamt) },
  }));
};

export interface BuildGstr1Args {
  company: CompanyMeta;
  from: string;
  to: string;
  fp: string; // "MMYYYY"
  sales: VoucherRow[];
  creditNotes: VoucherRow[];
  iffOnly?: boolean; // only B2B + CDNR (registered) — first 2 months of QRMP quarter
}

export function buildGstr1(args: BuildGstr1Args): BuiltGstr1 {
  const { company, sales, creditNotes, fp, from, to, iffOnly } = args;
  const compState = company.state_code ?? "";

  const b2b: B2BInvoice[] = [];
  const b2cl: B2CLInvoice[] = [];
  const b2csMap = new Map<string, B2CSGroup>();

  for (const v of sales) {
    const pos = v.place_of_supply_code || v.ledgers?.state_code || compState;
    const partyGstin = v.ledgers?.gstin || "";
    if (partyGstin) {
      b2b.push({
        ctin: partyGstin,
        inum: v.voucher_number,
        idt: fmtDDMMYYYY(v.voucher_date),
        val: r(v.total_paise),
        pos: (pos || "").padStart(2, "0"),
        rchrg: "N",
        inv_typ: "R",
        itms: lineFromVoucherItems(v.voucher_items),
      });
    } else if (iffOnly) {
      // IFF: skip B2C
      continue;
    } else {
      const interstate = v.is_interstate;
      if (interstate && v.total_paise > B2CL_THRESHOLD_PAISE) {
        b2cl.push({
          inum: v.voucher_number,
          idt: fmtDDMMYYYY(v.voucher_date),
          val: r(v.total_paise),
          pos: (pos || "").padStart(2, "0"),
          itms: lineFromVoucherItems(v.voucher_items),
        });
      } else {
        // B2CS: aggregate by (sply_ty, pos, rate)
        for (const it of v.voucher_items) {
          const key = `${interstate ? "INTER" : "INTRA"}|${pos}|${it.gst_rate}`;
          const cur = b2csMap.get(key) ?? {
            sply_ty: interstate ? "INTER" : "INTRA",
            pos: (pos || "").padStart(2, "0"),
            rt: it.gst_rate,
            txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0,
            typ: "OE",
          } satisfies B2CSGroup;
          cur.txval += it.taxable_paise;
          cur.iamt += it.igst_paise;
          cur.camt += it.cgst_paise;
          cur.samt += it.sgst_paise;
          b2csMap.set(key, cur);
        }
      }
    }
  }

  const cdnr: CDNRInvoice[] = [];
  const cdnur: CDNURInvoice[] = [];
  for (const v of creditNotes) {
    const ntty: "C" | "D" = v.voucher_type === "credit_note" ? "C" : "D";
    const pos = v.place_of_supply_code || v.ledgers?.state_code || compState;
    const partyGstin = v.ledgers?.gstin || "";
    if (partyGstin) {
      cdnr.push({
        ctin: partyGstin,
        nt_num: v.voucher_number,
        nt_dt: fmtDDMMYYYY(v.voucher_date),
        ntty,
        val: r(v.total_paise),
        pos: (pos || "").padStart(2, "0"),
        rchrg: "N",
        inv_typ: "R",
        itms: lineFromVoucherItems(v.voucher_items),
      });
    } else if (!iffOnly && v.is_interstate && v.total_paise > B2CL_THRESHOLD_PAISE) {
      cdnur.push({
        typ: "B2CL",
        nt_num: v.voucher_number,
        nt_dt: fmtDDMMYYYY(v.voucher_date),
        ntty,
        val: r(v.total_paise),
        pos: (pos || "").padStart(2, "0"),
        itms: lineFromVoucherItems(v.voucher_items),
      });
    }
  }

  const b2cs = Array.from(b2csMap.values()).map((g) => ({
    ...g,
    txval: r(g.txval), iamt: r(g.iamt), camt: r(g.camt), samt: r(g.samt), csamt: r(g.csamt),
  }));

  // HSN summary across both sales + CDNR (CDN reduces — represented via sign)
  const hsnMap = new Map<string, HSNRow>();
  const accumulate = (v: VoucherRow, sign: 1 | -1) => {
    for (const it of v.voucher_items) {
      const key = `${it.items?.hsn_code || ""}|${it.gst_rate}|${it.items?.unit || "OTH"}`;
      const cur = hsnMap.get(key) ?? {
        hsn_sc: it.items?.hsn_code || "",
        desc: it.items?.name || "",
        uqc: (it.items?.unit || "OTH").toUpperCase().slice(0, 3) + "-" + (it.items?.unit || "OTH").toUpperCase(),
        qty: 0, rt: it.gst_rate,
        txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, val: 0,
      } satisfies HSNRow;
      cur.qty += sign * Number(it.qty);
      cur.txval += sign * it.taxable_paise;
      cur.iamt += sign * it.igst_paise;
      cur.camt += sign * it.cgst_paise;
      cur.samt += sign * it.sgst_paise;
      cur.val += sign * (it.taxable_paise + it.cgst_paise + it.sgst_paise + it.igst_paise);
      hsnMap.set(key, cur);
    }
  };
  for (const v of sales) accumulate(v, 1);
  if (!iffOnly) for (const v of creditNotes) accumulate(v, v.voucher_type === "credit_note" ? -1 : 1);

  const hsn = Array.from(hsnMap.values()).map((h) => ({
    ...h,
    qty: Number(h.qty.toFixed(3)),
    txval: r(h.txval), iamt: r(h.iamt), camt: r(h.camt), samt: r(h.samt), val: r(h.val),
  }));

  // DOCS — Document issue summary (Sec 13). Best-effort: scan voucher numbers per type.
  const docs: DocSummary[] = [];
  const buildDocFor = (label: string, nums: string[]) => {
    if (!nums.length) return;
    const sorted = [...nums].sort();
    docs.push({
      doc_typ: label,
      from: sorted[0],
      to: sorted[sorted.length - 1],
      totnum: sorted.length,
      cancel: 0,
      net_issue: sorted.length,
    });
  };
  buildDocFor("Invoices for outward supply", sales.map((v) => v.voucher_number));
  buildDocFor("Credit Note", creditNotes.filter((v) => v.voucher_type === "credit_note").map((v) => v.voucher_number));
  buildDocFor("Debit Note", creditNotes.filter((v) => v.voucher_type === "debit_note").map((v) => v.voucher_number));

  return {
    meta: { gstin: company.gstin || "", fp, from, to },
    b2b, b2cl, b2cs, cdnr, cdnur, hsn, docs,
  };
}

// ───────────────────── GSTR-1 → GSTN JSON ─────────────────────

export function gstr1ToJson(g: BuiltGstr1): Record<string, unknown> {
  // Re-shape to GSTN format. B2B grouped by ctin; CDNR grouped by ctin.
  const byCtin = new Map<string, B2BInvoice[]>();
  for (const inv of g.b2b) {
    const list = byCtin.get(inv.ctin) ?? [];
    list.push(inv);
    byCtin.set(inv.ctin, list);
  }
  const b2b = Array.from(byCtin.entries()).map(([ctin, inv]) => ({ ctin, inv }));

  const byCtinCdn = new Map<string, CDNRInvoice[]>();
  for (const n of g.cdnr) {
    const list = byCtinCdn.get(n.ctin) ?? [];
    list.push(n);
    byCtinCdn.set(n.ctin, list);
  }
  const cdnr = Array.from(byCtinCdn.entries()).map(([ctin, nt]) => ({ ctin, nt }));

  return {
    gstin: g.meta.gstin,
    fp: g.meta.fp,
    gt: 0,
    cur_gt: 0,
    b2b,
    b2cl: g.b2cl.length ? [{ pos: g.b2cl[0]?.pos ?? "", inv: g.b2cl }] : [],
    b2cs: g.b2cs,
    cdnr,
    cdnur: g.cdnur,
    hsn: { data: g.hsn.map((h, i) => ({ num: i + 1, ...h })) },
    doc_issue: {
      doc_det: [
        { doc_num: 1, docs: g.docs.filter((d) => d.doc_typ.startsWith("Invoices")).map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
        { doc_num: 4, docs: g.docs.filter((d) => d.doc_typ === "Credit Note").map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
        { doc_num: 5, docs: g.docs.filter((d) => d.doc_typ === "Debit Note").map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
      ].filter((s) => s.docs.length),
    },
  };
}

// ───────────────────── GSTR-1 → Offline-Tool xlsx sheets ─────────────────────

import type { XlsxSheet } from "@/lib/exporters";

export function gstr1ToXlsxSheets(g: BuiltGstr1): XlsxSheet[] {
  const headerRows = (extra: (string | number)[][]): (string | number)[][] => [
    ["Summary For GSTR-1"],
    [`GSTIN of Supplier: ${g.meta.gstin}`, `FP: ${g.meta.fp}`],
    [],
    ...extra,
  ];

  const b2bRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const inv of g.b2b) {
    for (const it of inv.itms) {
      b2bRows.push([inv.ctin, inv.inum, inv.idt, inv.val, inv.pos, inv.rchrg, "", inv.inv_typ, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);
    }
  }

  const b2clRows: (string | number)[][] = [
    ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  ];
  for (const inv of g.b2cl) {
    for (const it of inv.itms) {
      b2clRows.push([inv.inum, inv.idt, inv.val, inv.pos, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, ""]);
    }
  }

  const b2csRows: (string | number)[][] = [
    ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  ];
  for (const g2 of g.b2cs) b2csRows.push([g2.sply_ty === "INTRA" ? "OE" : "OE", g2.pos, "", g2.rt, g2.txval, g2.csamt, ""]);

  const cdnrRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Note Number", "Note date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const n of g.cdnr) {
    for (const it of n.itms) {
      cdnrRows.push([n.ctin, n.nt_num, n.nt_dt, n.ntty, n.pos, n.rchrg, "R", n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);
    }
  }

  const cdnurRows: (string | number)[][] = [
    ["UR Type", "Note Number", "Note date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const n of g.cdnur) {
    for (const it of n.itms) {
      cdnurRows.push([n.typ, n.nt_num, n.nt_dt, n.ntty, n.pos, n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);
    }
  }

  const hsnRows: (string | number)[][] = [
    ["HSN", "Description", "UQC", "Total Quantity", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount", "Total Value"],
  ];
  for (const h of g.hsn) {
    hsnRows.push([h.hsn_sc, h.desc, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt, h.val]);
  }

  const docsRows: (string | number)[][] = [
    ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled", "Net Issued"],
  ];
  for (const d of g.docs) docsRows.push([d.doc_typ, d.from, d.to, d.totnum, d.cancel, d.net_issue]);

  return [
    { name: "b2b", rows: headerRows(b2bRows) },
    { name: "b2cl", rows: headerRows(b2clRows) },
    { name: "b2cs", rows: headerRows(b2csRows) },
    { name: "cdnr", rows: headerRows(cdnrRows) },
    { name: "cdnur", rows: headerRows(cdnurRows) },
    { name: "hsn", rows: headerRows(hsnRows) },
    { name: "docs", rows: headerRows(docsRows) },
  ];
}

// ───────────────────── GSTR-3B builder ─────────────────────

export interface BuiltGstr3B {
  meta: { gstin: string; fp: string; from: string; to: string };
  // 3.1 Outward
  sup_details: {
    osup_det: SupRow;   // (a) Taxable
    osup_zero: SupRow;  // (b) Zero-rated
    osup_nil_exmp: SupRow; // (c) Nil/Exempt/Non-GST
    isup_rev: SupRow;   // (d) Inward reverse charge
    osup_nongst: SupRow;// (e) Non-GST
  };
  // 3.2 Inter-state to UR / Composition / UIN
  inter_sup: { unreg_details: PosRow[]; comp_details: PosRow[]; uin_details: PosRow[] };
  // 4 ITC
  itc_elg: {
    itc_avl: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
    itc_rev: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
    itc_net: { iamt: number; camt: number; samt: number; csamt: number };
    itc_inelg: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
  };
  // 5 Exempt / Nil / Non-GST inward
  inward_sup: { isup_details: { ty: "GST" | "NONGST"; inter: number; intra: number }[] };
  // 6.1 Payable
  tax_pmt: {
    iamt: number; camt: number; samt: number; csamt: number;
    iamt_payable: number; camt_payable: number; samt_payable: number; csamt_payable: number;
  };
}

interface SupRow { txval: number; iamt: number; camt: number; samt: number; csamt: number }
interface PosRow { pos: string; txval: number; iamt: number }

export interface BuildGstr3BArgs {
  company: CompanyMeta;
  from: string;
  to: string;
  fp: string;
  sales: VoucherRow[];
  purchases: VoucherRow[];
  creditNotes: VoucherRow[];
  debitNotes: VoucherRow[];
}

const zeroSup = (): SupRow => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });

export function buildGstr3B(args: BuildGstr3BArgs): BuiltGstr3B {
  const { company, sales, purchases, creditNotes, debitNotes, fp, from, to } = args;
  const compState = company.state_code ?? "";

  // 3.1(a) — outward taxable = Sales − Credit Notes + Debit Notes (towards customer invoices)
  const osup_det: SupRow = zeroSup();
  const accSup = (v: VoucherRow, sign: 1 | -1) => {
    osup_det.txval += sign * v.subtotal_paise;
    osup_det.iamt += sign * v.igst_paise;
    osup_det.camt += sign * v.cgst_paise;
    osup_det.samt += sign * v.sgst_paise;
  };
  for (const v of sales) accSup(v, 1);
  for (const v of creditNotes) if (v.voucher_type === "credit_note") accSup(v, -1);
  for (const v of debitNotes) if (v.voucher_type === "debit_note") accSup(v, 1);

  // 3.2 — inter-state supplies to unregistered (ledger.gstin null + interstate)
  const unregMap = new Map<string, PosRow>();
  for (const v of sales) {
    if (v.is_interstate && !v.ledgers?.gstin) {
      const pos = (v.place_of_supply_code || v.ledgers?.state_code || compState).padStart(2, "0");
      const cur = unregMap.get(pos) ?? { pos, txval: 0, iamt: 0 };
      cur.txval += v.subtotal_paise;
      cur.iamt += v.igst_paise;
      unregMap.set(pos, cur);
    }
  }
  const unreg_details: PosRow[] = Array.from(unregMap.values()).map((p) => ({ pos: p.pos, txval: r(p.txval), iamt: r(p.iamt) }));

  // 4 ITC — purchases - debit notes + credit notes (returns reduce ITC)
  const itcRow = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const accItc = (v: VoucherRow, sign: 1 | -1) => {
    itcRow.iamt += sign * v.igst_paise;
    itcRow.camt += sign * v.cgst_paise;
    itcRow.samt += sign * v.sgst_paise;
  };
  for (const v of purchases) accItc(v, 1);
  for (const v of debitNotes) if (v.voucher_type === "debit_note") accItc(v, 1);
  for (const v of creditNotes) if (v.voucher_type === "credit_note") accItc(v, -1);

  const itc_avl = [{ ty: "OTH", iamt: r(itcRow.iamt), camt: r(itcRow.camt), samt: r(itcRow.samt), csamt: 0 }];
  const itc_net = { iamt: r(itcRow.iamt), camt: r(itcRow.camt), samt: r(itcRow.samt), csamt: 0 };

  // 6.1 Payable = Output - ITC
  const iamt_payable = Math.max(0, osup_det.iamt - itcRow.iamt);
  const camt_payable = Math.max(0, osup_det.camt - itcRow.camt);
  const samt_payable = Math.max(0, osup_det.samt - itcRow.samt);

  return {
    meta: { gstin: company.gstin || "", fp, from, to },
    sup_details: {
      osup_det: { txval: r(osup_det.txval), iamt: r(osup_det.iamt), camt: r(osup_det.camt), samt: r(osup_det.samt), csamt: 0 },
      osup_zero: zeroSup(),
      osup_nil_exmp: zeroSup(),
      isup_rev: zeroSup(),
      osup_nongst: zeroSup(),
    },
    inter_sup: { unreg_details, comp_details: [], uin_details: [] },
    itc_elg: {
      itc_avl,
      itc_rev: [],
      itc_net,
      itc_inelg: [],
    },
    inward_sup: { isup_details: [{ ty: "GST", inter: 0, intra: 0 }, { ty: "NONGST", inter: 0, intra: 0 }] },
    tax_pmt: {
      iamt: r(osup_det.iamt), camt: r(osup_det.camt), samt: r(osup_det.samt), csamt: 0,
      iamt_payable: r(iamt_payable), camt_payable: r(camt_payable), samt_payable: r(samt_payable), csamt_payable: 0,
    },
  };
}

export function gstr3bToJson(b: BuiltGstr3B): Record<string, unknown> {
  return {
    gstin: b.meta.gstin,
    ret_period: b.meta.fp,
    sup_details: b.sup_details,
    inter_sup: b.inter_sup,
    itc_elg: b.itc_elg,
    inward_sup: b.inward_sup,
    tax_pmt: b.tax_pmt,
  };
}

export function gstr3bToXlsxSheets(b: BuiltGstr3B): XlsxSheet[] {
  const s = b.sup_details;
  const summary: (string | number)[][] = [
    [`GSTR-3B for ${b.meta.gstin} — ${b.meta.fp}`],
    [],
    ["3.1 Details of Outward Supplies and inward supplies liable to reverse charge"],
    ["Nature of Supplies", "Total Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", s.osup_det.txval, s.osup_det.iamt, s.osup_det.camt, s.osup_det.samt, s.osup_det.csamt],
    ["(b) Outward taxable supplies (zero rated)", s.osup_zero.txval, s.osup_zero.iamt, 0, 0, s.osup_zero.csamt],
    ["(c) Other outward supplies (nil rated, exempted)", s.osup_nil_exmp.txval, 0, 0, 0, 0],
    ["(d) Inward supplies (liable to reverse charge)", s.isup_rev.txval, s.isup_rev.iamt, s.isup_rev.camt, s.isup_rev.samt, s.isup_rev.csamt],
    ["(e) Non-GST outward supplies", s.osup_nongst.txval, 0, 0, 0, 0],
    [],
    ["3.2 Of the supplies in 3.1(a), inter-state supplies made to unregistered persons / composition / UIN"],
    ["Place of Supply (State/UT)", "Total Taxable Value", "Amount of Integrated Tax"],
    ...b.inter_sup.unreg_details.map((p) => [p.pos, p.txval, p.iamt]),
    [],
    ["4. Eligible ITC"],
    ["Details", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["(A) ITC Available — All other ITC", b.itc_elg.itc_avl[0].iamt, b.itc_elg.itc_avl[0].camt, b.itc_elg.itc_avl[0].samt, 0],
    ["(C) Net ITC Available", b.itc_elg.itc_net.iamt, b.itc_elg.itc_net.camt, b.itc_elg.itc_net.samt, 0],
    [],
    ["6.1 Payment of tax"],
    ["Description", "Tax Payable", "Paid through ITC (IGST)", "Tax/Cess paid in cash"],
    ["Integrated Tax", b.tax_pmt.iamt, Math.min(b.tax_pmt.iamt, b.itc_elg.itc_net.iamt), b.tax_pmt.iamt_payable],
    ["Central Tax", b.tax_pmt.camt, 0, b.tax_pmt.camt_payable],
    ["State/UT Tax", b.tax_pmt.samt, 0, b.tax_pmt.samt_payable],
    ["Cess", 0, 0, 0],
  ];
  return [{ name: "GSTR-3B", rows: summary }];
}

export const downloadJson = (fileName: string, payload: unknown): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
};
