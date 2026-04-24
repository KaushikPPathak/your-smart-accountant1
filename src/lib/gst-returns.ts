// GST Returns builder — full GSTR-1 (regular + amendments + EXP/NIL) and
// full GSTR-3B (3.1 a–e, 3.1.1, 3.2, 4 with reversal/ineligible, 5, 6.1).
// Output formats: GSTN portal JSON + GST Offline-Tool Excel sheets.
// All amounts internally in paise; converted to rupees (2dp) on output.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { XlsxSheet } from "@/lib/exporters";

type VoucherTypeEnum = Database["public"]["Enums"]["voucher_type"];
type SupplyNature = Database["public"]["Enums"]["supply_nature"];
type GstTreatment = Database["public"]["Enums"]["gst_treatment"];

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
  supply_nature: SupplyNature;
  shipping_bill_no: string | null;
  shipping_bill_date: string | null;
  port_code: string | null;
  is_amendment: boolean;
  orig_invoice_no: string | null;
  orig_invoice_date: string | null;
  orig_period: string | null;
  ledgers: {
    name: string;
    gstin: string | null;
    state_code: string | null;
    gst_treatment: GstTreatment;
    country: string | null;
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
  b2ba: B2BAInvoice[];
  b2cl: B2CLInvoice[];
  b2cla: B2CLAInvoice[];
  b2cs: B2CSGroup[];
  cdnr: CDNRInvoice[];
  cdnra: CDNRAInvoice[];
  cdnur: CDNURInvoice[];
  exp: EXPInvoice[];
  nil: NilGroup[];
  hsn_b2b: HSNRow[];
  hsn_b2c: HSNRow[];
  docs: DocSummary[];
}

export interface B2BInvoice {
  ctin: string;
  inum: string;
  idt: string;
  val: number;
  pos: string;
  rchrg: "N" | "Y";
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE";
  itms: TaxLine[];
}
export interface B2BAInvoice extends B2BInvoice {
  oinum: string;
  oidt: string;
}
export interface B2CLInvoice {
  inum: string;
  idt: string;
  val: number;
  pos: string;
  itms: TaxLine[];
}
export interface B2CLAInvoice extends B2CLInvoice {
  oinum: string;
  oidt: string;
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
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE";
  itms: TaxLine[];
}
export interface CDNRAInvoice extends CDNRInvoice {
  ont_num: string;
  ont_dt: string;
}
export interface CDNURInvoice {
  typ: "B2CL" | "EXPWP" | "EXPWOP";
  nt_num: string;
  nt_dt: string;
  ntty: "C" | "D";
  val: number;
  pos: string;
  itms: TaxLine[];
}
export interface EXPInvoice {
  exp_typ: "WPAY" | "WOPAY";
  inum: string;
  idt: string;
  val: number;
  sbpcode?: string;
  sbnum?: string;
  sbdt?: string;
  itms: { txval: number; rt: number; iamt: number; csamt: number }[];
}
export interface NilGroup {
  sply_ty: "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C";
  nil_amt: number;
  expt_amt: number;
  ngsup_amt: number;
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
  const startMonth = (q - 1) * 3 + 1;
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
supply_nature, shipping_bill_no, shipping_bill_date, port_code,
is_amendment, orig_invoice_no, orig_invoice_date, orig_period,
ledgers:party_ledger_id(name, gstin, state_code, gst_treatment, country),
voucher_items(qty, rate_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate,
items:item_id(name, hsn_code, unit))`;

export async function fetchVouchers(
  companyId: string,
  from: string,
  to: string,
  types: VoucherTypeEnum[],
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

export interface InwardSummaryRow {
  ty: "GST" | "NONGST";
  inter_paise: number;
  intra_paise: number;
}
export async function fetchInwardSummary(companyId: string, period: string): Promise<InwardSummaryRow[]> {
  const { data } = await supabase
    .from("gstr3b_inward_summary")
    .select("ty, inter_paise, intra_paise")
    .eq("company_id", companyId)
    .eq("period", period);
  return (data || []) as InwardSummaryRow[];
}

export interface ItcReversalRow {
  ty: "RUL" | "OTH";
  iamt_paise: number;
  camt_paise: number;
  samt_paise: number;
  csamt_paise: number;
}
export async function fetchItcReversal(companyId: string, period: string): Promise<ItcReversalRow[]> {
  const { data } = await supabase
    .from("gstr3b_itc_reversal")
    .select("ty, iamt_paise, camt_paise, samt_paise, csamt_paise")
    .eq("company_id", companyId)
    .eq("period", period);
  return (data || []) as ItcReversalRow[];
}

// ───────────────────── GSTR-1 builder ─────────────────────

const B2CL_THRESHOLD_PAISE = 250000_00;

const lineFromVoucherItems = (items: VoucherRow["voucher_items"]): TaxLine[] => {
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

const invTypeFromTreatment = (t: GstTreatment | undefined): "R" | "SEWP" | "SEWOP" | "DE" => {
  if (t === "sez_with_payment") return "SEWP";
  if (t === "sez_without_payment") return "SEWOP";
  if (t === "deemed_export") return "DE";
  return "R";
};

const isExportTreatment = (t: GstTreatment | undefined): boolean =>
  t === "overseas" || t === "sez_with_payment" || t === "sez_without_payment";

export interface BuildGstr1Args {
  company: CompanyMeta;
  from: string;
  to: string;
  fp: string;
  sales: VoucherRow[];
  creditNotes: VoucherRow[];
  iffOnly?: boolean;
}

export function buildGstr1(args: BuildGstr1Args): BuiltGstr1 {
  const { company, sales, creditNotes, fp, from, to, iffOnly } = args;
  const compState = company.state_code ?? "";

  const b2b: B2BInvoice[] = [];
  const b2ba: B2BAInvoice[] = [];
  const b2cl: B2CLInvoice[] = [];
  const b2cla: B2CLAInvoice[] = [];
  const b2csMap = new Map<string, B2CSGroup>();
  const exp: EXPInvoice[] = [];
  const nilMap = new Map<NilGroup["sply_ty"], NilGroup>();

  const accNil = (v: VoucherRow) => {
    const interstate = v.is_interstate;
    const partyGstin = v.ledgers?.gstin || "";
    const key: NilGroup["sply_ty"] = interstate
      ? (partyGstin ? "INTRB2B" : "INTRB2C")
      : (partyGstin ? "INTRAB2B" : "INTRAB2C");
    const cur = nilMap.get(key) ?? { sply_ty: key, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
    if (v.supply_nature === "nil_rated") cur.nil_amt += v.subtotal_paise;
    else if (v.supply_nature === "exempt") cur.expt_amt += v.subtotal_paise;
    else if (v.supply_nature === "non_gst") cur.ngsup_amt += v.subtotal_paise;
    nilMap.set(key, cur);
  };

  for (const v of sales) {
    const sn = v.supply_nature;

    if (sn === "nil_rated" || sn === "exempt" || sn === "non_gst") {
      accNil(v);
      continue;
    }

    if (sn === "zero_rated_wp" || sn === "zero_rated_wop" || isExportTreatment(v.ledgers?.gst_treatment)) {
      const treatment = v.ledgers?.gst_treatment;
      // SEZ → goes to B2B with SEWP/SEWOP (per GSTN format)
      if (treatment === "sez_with_payment" || treatment === "sez_without_payment") {
        b2b.push({
          ctin: v.ledgers?.gstin || "",
          inum: v.voucher_number,
          idt: fmtDDMMYYYY(v.voucher_date),
          val: r(v.total_paise),
          pos: (v.place_of_supply_code || v.ledgers?.state_code || "").padStart(2, "0"),
          rchrg: "N",
          inv_typ: invTypeFromTreatment(treatment),
          itms: lineFromVoucherItems(v.voucher_items),
        });
        continue;
      }
      // Overseas / explicit zero-rated → EXP
      const exp_typ: "WPAY" | "WOPAY" = sn === "zero_rated_wop" ? "WOPAY" : "WPAY";
      const itms = (() => {
        const m = new Map<number, { txval: number; rt: number; iamt: number; csamt: number }>();
        for (const it of v.voucher_items) {
          const cur = m.get(it.gst_rate) ?? { rt: it.gst_rate, txval: 0, iamt: 0, csamt: 0 };
          cur.txval += it.taxable_paise;
          cur.iamt += it.igst_paise;
          m.set(it.gst_rate, cur);
        }
        return Array.from(m.values()).map((g) => ({ rt: g.rt, txval: r(g.txval), iamt: r(g.iamt), csamt: r(g.csamt) }));
      })();
      exp.push({
        exp_typ,
        inum: v.voucher_number,
        idt: fmtDDMMYYYY(v.voucher_date),
        val: r(v.total_paise),
        sbpcode: v.port_code || undefined,
        sbnum: v.shipping_bill_no || undefined,
        sbdt: v.shipping_bill_date ? fmtDDMMYYYY(v.shipping_bill_date) : undefined,
        itms,
      });
      continue;
    }

    // taxable / deemed_export
    const pos = v.place_of_supply_code || v.ledgers?.state_code || compState;
    const partyGstin = v.ledgers?.gstin || "";

    if (partyGstin) {
      const inv_typ = invTypeFromTreatment(v.ledgers?.gst_treatment);
      const target: B2BInvoice = {
        ctin: partyGstin,
        inum: v.voucher_number,
        idt: fmtDDMMYYYY(v.voucher_date),
        val: r(v.total_paise),
        pos: (pos || "").padStart(2, "0"),
        rchrg: "N",
        inv_typ,
        itms: lineFromVoucherItems(v.voucher_items),
      };
      if (v.is_amendment && v.orig_invoice_no && v.orig_invoice_date) {
        b2ba.push({ ...target, oinum: v.orig_invoice_no, oidt: fmtDDMMYYYY(v.orig_invoice_date) });
      } else {
        b2b.push(target);
      }
    } else if (iffOnly) {
      continue;
    } else {
      const interstate = v.is_interstate;
      if (interstate && v.total_paise > B2CL_THRESHOLD_PAISE) {
        const target: B2CLInvoice = {
          inum: v.voucher_number,
          idt: fmtDDMMYYYY(v.voucher_date),
          val: r(v.total_paise),
          pos: (pos || "").padStart(2, "0"),
          itms: lineFromVoucherItems(v.voucher_items),
        };
        if (v.is_amendment && v.orig_invoice_no && v.orig_invoice_date) {
          b2cla.push({ ...target, oinum: v.orig_invoice_no, oidt: fmtDDMMYYYY(v.orig_invoice_date) });
        } else {
          b2cl.push(target);
        }
      } else {
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
  const cdnra: CDNRAInvoice[] = [];
  const cdnur: CDNURInvoice[] = [];
  for (const v of creditNotes) {
    const ntty: "C" | "D" = v.voucher_type === "credit_note" ? "C" : "D";
    const pos = v.place_of_supply_code || v.ledgers?.state_code || compState;
    const partyGstin = v.ledgers?.gstin || "";
    const inv_typ = invTypeFromTreatment(v.ledgers?.gst_treatment);

    if (partyGstin) {
      const note: CDNRInvoice = {
        ctin: partyGstin,
        nt_num: v.voucher_number,
        nt_dt: fmtDDMMYYYY(v.voucher_date),
        ntty,
        val: r(v.total_paise),
        pos: (pos || "").padStart(2, "0"),
        rchrg: "N",
        inv_typ,
        itms: lineFromVoucherItems(v.voucher_items),
      };
      if (v.is_amendment && v.orig_invoice_no && v.orig_invoice_date) {
        cdnra.push({ ...note, ont_num: v.orig_invoice_no, ont_dt: fmtDDMMYYYY(v.orig_invoice_date) });
      } else {
        cdnr.push(note);
      }
    } else if (!iffOnly) {
      const isExp = isExportTreatment(v.ledgers?.gst_treatment) || v.supply_nature === "zero_rated_wp" || v.supply_nature === "zero_rated_wop";
      const typ: CDNURInvoice["typ"] = isExp ? (v.supply_nature === "zero_rated_wop" ? "EXPWOP" : "EXPWP") : "B2CL";
      if (typ !== "B2CL" || (v.is_interstate && v.total_paise > B2CL_THRESHOLD_PAISE)) {
        cdnur.push({
          typ,
          nt_num: v.voucher_number,
          nt_dt: fmtDDMMYYYY(v.voucher_date),
          ntty,
          val: r(v.total_paise),
          pos: (pos || "").padStart(2, "0"),
          itms: lineFromVoucherItems(v.voucher_items),
        });
      }
    }
  }

  const b2cs = Array.from(b2csMap.values()).map((g) => ({
    ...g,
    txval: r(g.txval), iamt: r(g.iamt), camt: r(g.camt), samt: r(g.samt), csamt: r(g.csamt),
  }));

  const nil = Array.from(nilMap.values()).map((g) => ({
    ...g, nil_amt: r(g.nil_amt), expt_amt: r(g.expt_amt), ngsup_amt: r(g.ngsup_amt),
  }));

  // HSN summary across taxable + zero-rated sales (CDN reduces with sign)
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
    b2b, b2ba, b2cl, b2cla, b2cs, cdnr, cdnra, cdnur, exp, nil, hsn, docs,
  };
}

// ───────────────────── GSTR-1 → GSTN JSON ─────────────────────

const groupByCtinB2B = <T extends { ctin: string }>(arr: T[], key: "inv" | "nt"): { ctin: string; [k: string]: unknown }[] => {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const list = m.get(x.ctin) ?? [];
    list.push(x);
    m.set(x.ctin, list);
  }
  return Array.from(m.entries()).map(([ctin, list]) => ({ ctin, [key]: list }));
};

export function gstr1ToJson(g: BuiltGstr1): Record<string, unknown> {
  const out: Record<string, unknown> = {
    gstin: g.meta.gstin,
    fp: g.meta.fp,
    gt: 0,
    cur_gt: 0,
  };
  if (g.b2b.length) out.b2b = groupByCtinB2B(g.b2b, "inv");
  if (g.b2ba.length) out.b2ba = groupByCtinB2B(g.b2ba, "inv");
  if (g.b2cl.length) {
    const byPos = new Map<string, B2CLInvoice[]>();
    for (const inv of g.b2cl) {
      const list = byPos.get(inv.pos) ?? [];
      list.push(inv);
      byPos.set(inv.pos, list);
    }
    out.b2cl = Array.from(byPos.entries()).map(([pos, inv]) => ({ pos, inv }));
  }
  if (g.b2cla.length) {
    const byPos = new Map<string, B2CLAInvoice[]>();
    for (const inv of g.b2cla) {
      const list = byPos.get(inv.pos) ?? [];
      list.push(inv);
      byPos.set(inv.pos, list);
    }
    out.b2cla = Array.from(byPos.entries()).map(([pos, inv]) => ({ pos, inv }));
  }
  if (g.b2cs.length) out.b2cs = g.b2cs;
  if (g.cdnr.length) out.cdnr = groupByCtinB2B(g.cdnr, "nt");
  if (g.cdnra.length) out.cdnra = groupByCtinB2B(g.cdnra, "nt");
  if (g.cdnur.length) out.cdnur = g.cdnur;
  if (g.exp.length) {
    const byTyp = new Map<string, EXPInvoice[]>();
    for (const e of g.exp) {
      const list = byTyp.get(e.exp_typ) ?? [];
      list.push(e);
      byTyp.set(e.exp_typ, list);
    }
    out.exp = Array.from(byTyp.entries()).map(([exp_typ, inv]) => ({ exp_typ, inv }));
  }
  if (g.nil.length) out.nil = { inv: g.nil };
  if (g.hsn.length) out.hsn = { data: g.hsn.map((h, i) => ({ num: i + 1, ...h })) };
  out.doc_issue = {
    doc_det: [
      { doc_num: 1, docs: g.docs.filter((d) => d.doc_typ.startsWith("Invoices")).map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
      { doc_num: 4, docs: g.docs.filter((d) => d.doc_typ === "Credit Note").map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
      { doc_num: 5, docs: g.docs.filter((d) => d.doc_typ === "Debit Note").map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue })) },
    ].filter((s) => s.docs.length),
  };
  return out;
}

// ───────────────────── GSTR-1 → Offline-Tool xlsx sheets ─────────────────────

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
  for (const inv of g.b2b) for (const it of inv.itms)
    b2bRows.push([inv.ctin, inv.inum, inv.idt, inv.val, inv.pos, inv.rchrg, "", inv.inv_typ, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const b2baRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Invoice Type", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const inv of g.b2ba) for (const it of inv.itms)
    b2baRows.push([inv.ctin, inv.oinum, inv.oidt, inv.inum, inv.idt, inv.val, inv.pos, inv.rchrg, inv.inv_typ, it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const b2clRows: (string | number)[][] = [
    ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  ];
  for (const inv of g.b2cl) for (const it of inv.itms)
    b2clRows.push([inv.inum, inv.idt, inv.val, inv.pos, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, ""]);

  const b2claRows: (string | number)[][] = [
    ["Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Place Of Supply", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const inv of g.b2cla) for (const it of inv.itms)
    b2claRows.push([inv.oinum, inv.oidt, inv.inum, inv.idt, inv.val, inv.pos, it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const b2csRows: (string | number)[][] = [
    ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  ];
  for (const g2 of g.b2cs) b2csRows.push(["OE", g2.pos, "", g2.rt, g2.txval, g2.csamt, ""]);

  const cdnrRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Note Number", "Note date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const n of g.cdnr) for (const it of n.itms)
    cdnrRows.push([n.ctin, n.nt_num, n.nt_dt, n.ntty, n.pos, n.rchrg, n.inv_typ, n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const cdnraRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Original Note Number", "Original Note date", "Revised Note Number", "Revised Note date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const n of g.cdnra) for (const it of n.itms)
    cdnraRows.push([n.ctin, n.ont_num, n.ont_dt, n.nt_num, n.nt_dt, n.ntty, n.pos, n.rchrg, n.inv_typ, n.val, it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const cdnurRows: (string | number)[][] = [
    ["UR Type", "Note Number", "Note date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const n of g.cdnur) for (const it of n.itms)
    cdnurRows.push([n.typ, n.nt_num, n.nt_dt, n.ntty, n.pos, n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const expRows: (string | number)[][] = [
    ["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const e of g.exp) for (const it of e.itms)
    expRows.push([e.exp_typ, e.inum, e.idt, e.val, e.sbpcode || "", e.sbnum || "", e.sbdt || "", it.rt, it.txval, it.csamt]);

  const nilRows: (string | number)[][] = [
    ["Description", "Nil Rated Supplies", "Exempted (other than nil rated/non GST supply)", "Non-GST Supplies"],
  ];
  for (const n of g.nil) nilRows.push([n.sply_ty, n.nil_amt, n.expt_amt, n.ngsup_amt]);

  const hsnRows: (string | number)[][] = [
    ["HSN", "Description", "UQC", "Total Quantity", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount", "Total Value"],
  ];
  for (const h of g.hsn) hsnRows.push([h.hsn_sc, h.desc, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt, h.val]);

  const docsRows: (string | number)[][] = [
    ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled", "Net Issued"],
  ];
  for (const d of g.docs) docsRows.push([d.doc_typ, d.from, d.to, d.totnum, d.cancel, d.net_issue]);

  return [
    { name: "b2b", rows: headerRows(b2bRows) },
    { name: "b2ba", rows: headerRows(b2baRows) },
    { name: "b2cl", rows: headerRows(b2clRows) },
    { name: "b2cla", rows: headerRows(b2claRows) },
    { name: "b2cs", rows: headerRows(b2csRows) },
    { name: "cdnr", rows: headerRows(cdnrRows) },
    { name: "cdnra", rows: headerRows(cdnraRows) },
    { name: "cdnur", rows: headerRows(cdnurRows) },
    { name: "exp", rows: headerRows(expRows) },
    { name: "nil", rows: headerRows(nilRows) },
    { name: "hsn", rows: headerRows(hsnRows) },
    { name: "docs", rows: headerRows(docsRows) },
  ];
}

// ───────────────────── GSTR-3B builder ─────────────────────

export interface BuiltGstr3B {
  meta: { gstin: string; fp: string; from: string; to: string };
  sup_details: {
    osup_det: SupRow;
    osup_zero: SupRow;
    osup_nil_exmp: SupRow;
    isup_rev: SupRow;
    osup_nongst: SupRow;
  };
  // 3.1.1 supplies notified u/s 9(5) — kept zero by default (e-commerce operator)
  sup_eco?: { txval: number; iamt: number; camt: number; samt: number; csamt: number };
  inter_sup: { unreg_details: PosRow[]; comp_details: PosRow[]; uin_details: PosRow[] };
  itc_elg: {
    itc_avl: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
    itc_rev: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
    itc_net: { iamt: number; camt: number; samt: number; csamt: number };
    itc_inelg: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[];
  };
  inward_sup: { isup_details: { ty: "GST" | "NONGST"; inter: number; intra: number }[] };
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
  inwardSummary?: InwardSummaryRow[];
  itcReversal?: ItcReversalRow[];
  itcInelig?: { ty: "RUL_42_43" | "OTH"; iamt: number; camt: number; samt: number; csamt: number }[];
}

const zeroSup = (): SupRow => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });

export function buildGstr3B(args: BuildGstr3BArgs): BuiltGstr3B {
  const { company, sales, purchases, creditNotes, debitNotes, fp, from, to, inwardSummary = [], itcReversal = [] } = args;
  const compState = company.state_code ?? "";

  const osup_det = zeroSup();
  const osup_zero = zeroSup();
  const osup_nil_exmp = zeroSup();
  const osup_nongst = zeroSup();
  const isup_rev = zeroSup();

  const accInto = (target: SupRow, v: VoucherRow, sign: 1 | -1) => {
    target.txval += sign * v.subtotal_paise;
    target.iamt += sign * v.igst_paise;
    target.camt += sign * v.cgst_paise;
    target.samt += sign * v.sgst_paise;
  };

  const routeOutward = (v: VoucherRow, sign: 1 | -1) => {
    switch (v.supply_nature) {
      case "zero_rated_wp":
      case "zero_rated_wop":
        accInto(osup_zero, v, sign); return;
      case "nil_rated":
      case "exempt":
        osup_nil_exmp.txval += sign * v.subtotal_paise; return;
      case "non_gst":
        osup_nongst.txval += sign * v.subtotal_paise; return;
      case "rcm_inward":
        accInto(isup_rev, v, sign); return;
      default:
        accInto(osup_det, v, sign);
    }
  };

  for (const v of sales) routeOutward(v, 1);
  for (const v of creditNotes) if (v.voucher_type === "credit_note") routeOutward(v, -1);
  for (const v of debitNotes) if (v.voucher_type === "debit_note") routeOutward(v, 1);
  // Purchases under RCM contribute to 3.1(d)
  for (const v of purchases) if (v.supply_nature === "rcm_inward") accInto(isup_rev, v, 1);

  // 3.2 — inter-state supplies to unregistered (only from 3.1(a))
  const unregMap = new Map<string, PosRow>();
  for (const v of sales) {
    if (v.supply_nature !== "taxable") continue;
    if (v.is_interstate && !v.ledgers?.gstin) {
      const pos = (v.place_of_supply_code || v.ledgers?.state_code || compState).padStart(2, "0");
      const cur = unregMap.get(pos) ?? { pos, txval: 0, iamt: 0 };
      cur.txval += v.subtotal_paise;
      cur.iamt += v.igst_paise;
      unregMap.set(pos, cur);
    }
  }
  const unreg_details: PosRow[] = Array.from(unregMap.values()).map((p) => ({ pos: p.pos, txval: r(p.txval), iamt: r(p.iamt) }));

  // 4(A) ITC available — taxable purchases + RCM inward + debit notes - credit notes
  const itcAll = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const itcRcm = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  for (const v of purchases) {
    if (v.supply_nature === "rcm_inward") {
      itcRcm.iamt += v.igst_paise;
      itcRcm.camt += v.cgst_paise;
      itcRcm.samt += v.sgst_paise;
    } else {
      itcAll.iamt += v.igst_paise;
      itcAll.camt += v.cgst_paise;
      itcAll.samt += v.sgst_paise;
    }
  }
  for (const v of debitNotes) if (v.voucher_type === "debit_note") {
    itcAll.iamt += v.igst_paise; itcAll.camt += v.cgst_paise; itcAll.samt += v.sgst_paise;
  }
  for (const v of creditNotes) if (v.voucher_type === "credit_note") {
    itcAll.iamt -= v.igst_paise; itcAll.camt -= v.cgst_paise; itcAll.samt -= v.sgst_paise;
  }

  const itc_avl: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[] = [];
  if (itcRcm.iamt || itcRcm.camt || itcRcm.samt) {
    itc_avl.push({ ty: "ISRC", iamt: r(itcRcm.iamt), camt: r(itcRcm.camt), samt: r(itcRcm.samt), csamt: 0 });
  }
  itc_avl.push({ ty: "OTH", iamt: r(itcAll.iamt), camt: r(itcAll.camt), samt: r(itcAll.samt), csamt: 0 });

  // 4(B) reversal
  const itc_rev = itcReversal.map((row) => ({
    ty: row.ty === "RUL" ? "RUL" : "OTH",
    iamt: r(row.iamt_paise), camt: r(row.camt_paise), samt: r(row.samt_paise), csamt: r(row.csamt_paise),
  }));
  const revSum = itc_rev.reduce((a, x) => ({
    iamt: a.iamt + x.iamt * 100, camt: a.camt + x.camt * 100, samt: a.samt + x.samt * 100, csamt: a.csamt + x.csamt * 100,
  }), { iamt: 0, camt: 0, samt: 0, csamt: 0 });

  // 4(C) net = (avl total) - (rev total)
  const grossIamt = itcAll.iamt + itcRcm.iamt;
  const grossCamt = itcAll.camt + itcRcm.camt;
  const grossSamt = itcAll.samt + itcRcm.samt;
  const itc_net = {
    iamt: r(grossIamt - revSum.iamt),
    camt: r(grossCamt - revSum.camt),
    samt: r(grossSamt - revSum.samt),
    csamt: 0,
  };

  // 4(D) ineligible — passed in directly via args
  const itc_inelg = (args.itcInelig || []).map((x) => ({
    ty: x.ty === "RUL_42_43" ? "RUL" : "OTH",
    iamt: x.iamt, camt: x.camt, samt: x.samt, csamt: x.csamt,
  }));

  // 5 — Inward exempt/nil/non-GST (manual entry per period; defaults zero)
  const inwardGst = inwardSummary.find((x) => x.ty === "GST") ?? { ty: "GST" as const, inter_paise: 0, intra_paise: 0 };
  const inwardNon = inwardSummary.find((x) => x.ty === "NONGST") ?? { ty: "NONGST" as const, inter_paise: 0, intra_paise: 0 };

  // 6.1 Payable
  const outIamt = osup_det.iamt + osup_zero.iamt;
  const outCamt = osup_det.camt;
  const outSamt = osup_det.samt;
  const iamt_payable = Math.max(0, outIamt - itc_net.iamt * 100);
  const camt_payable = Math.max(0, outCamt - itc_net.camt * 100);
  const samt_payable = Math.max(0, outSamt - itc_net.samt * 100);

  return {
    meta: { gstin: company.gstin || "", fp, from, to },
    sup_details: {
      osup_det: { txval: r(osup_det.txval), iamt: r(osup_det.iamt), camt: r(osup_det.camt), samt: r(osup_det.samt), csamt: 0 },
      osup_zero: { txval: r(osup_zero.txval), iamt: r(osup_zero.iamt), camt: 0, samt: 0, csamt: 0 },
      osup_nil_exmp: { txval: r(osup_nil_exmp.txval), iamt: 0, camt: 0, samt: 0, csamt: 0 },
      isup_rev: { txval: r(isup_rev.txval), iamt: r(isup_rev.iamt), camt: r(isup_rev.camt), samt: r(isup_rev.samt), csamt: 0 },
      osup_nongst: { txval: r(osup_nongst.txval), iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
    sup_eco: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    inter_sup: { unreg_details, comp_details: [], uin_details: [] },
    itc_elg: { itc_avl, itc_rev, itc_net, itc_inelg },
    inward_sup: {
      isup_details: [
        { ty: "GST", inter: r(inwardGst.inter_paise), intra: r(inwardGst.intra_paise) },
        { ty: "NONGST", inter: r(inwardNon.inter_paise), intra: r(inwardNon.intra_paise) },
      ],
    },
    tax_pmt: {
      iamt: r(outIamt), camt: r(outCamt), samt: r(outSamt), csamt: 0,
      iamt_payable: r(iamt_payable), camt_payable: r(camt_payable), samt_payable: r(samt_payable), csamt_payable: 0,
    },
  };
}

export function gstr3bToJson(b: BuiltGstr3B): Record<string, unknown> {
  return {
    gstin: b.meta.gstin,
    ret_period: b.meta.fp,
    sup_details: b.sup_details,
    sup_eco: b.sup_eco,
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
    ["3.1 Outward Supplies & inward RCM"],
    ["Nature of Supplies", "Total Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["(a) Outward taxable", s.osup_det.txval, s.osup_det.iamt, s.osup_det.camt, s.osup_det.samt, s.osup_det.csamt],
    ["(b) Outward zero-rated", s.osup_zero.txval, s.osup_zero.iamt, 0, 0, s.osup_zero.csamt],
    ["(c) Other outward (nil/exempt)", s.osup_nil_exmp.txval, 0, 0, 0, 0],
    ["(d) Inward — reverse charge", s.isup_rev.txval, s.isup_rev.iamt, s.isup_rev.camt, s.isup_rev.samt, s.isup_rev.csamt],
    ["(e) Non-GST outward", s.osup_nongst.txval, 0, 0, 0, 0],
    [],
    ["3.2 Inter-state to Unregistered (from 3.1(a))"],
    ["Place of Supply", "Total Taxable Value", "Integrated Tax"],
    ...b.inter_sup.unreg_details.map((p) => [p.pos, p.txval, p.iamt]),
    [],
    ["4. Eligible ITC"],
    ["Details", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ...b.itc_elg.itc_avl.map((x) => [`(A) ITC Available — ${x.ty}`, x.iamt, x.camt, x.samt, x.csamt]),
    ...b.itc_elg.itc_rev.map((x) => [`(B) ITC Reversed — ${x.ty}`, x.iamt, x.camt, x.samt, x.csamt]),
    ["(C) Net ITC", b.itc_elg.itc_net.iamt, b.itc_elg.itc_net.camt, b.itc_elg.itc_net.samt, b.itc_elg.itc_net.csamt],
    ...b.itc_elg.itc_inelg.map((x) => [`(D) Ineligible — ${x.ty}`, x.iamt, x.camt, x.samt, x.csamt]),
    [],
    ["5. Inward Exempt/Nil/Non-GST"],
    ["Type", "Inter-state", "Intra-state"],
    ...b.inward_sup.isup_details.map((x) => [x.ty, x.inter, x.intra]),
    [],
    ["6.1 Payment of tax"],
    ["Description", "Tax Payable", "Net Cash Payable"],
    ["Integrated Tax", b.tax_pmt.iamt, b.tax_pmt.iamt_payable],
    ["Central Tax", b.tax_pmt.camt, b.tax_pmt.camt_payable],
    ["State/UT Tax", b.tax_pmt.samt, b.tax_pmt.samt_payable],
    ["Cess", 0, 0],
  ];
  return [{ name: "GSTR-3B", rows: summary }];
}

// ───────────────────── Validators ─────────────────────

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const POS_RE = /^[0-9]{2}$/;
const FP_RE = /^[0-9]{6}$/;

export interface ValidationIssue {
  level: "error" | "warning";
  section: string;
  message: string;
}

export function validateGstr1(g: BuiltGstr1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!GSTIN_RE.test(g.meta.gstin)) issues.push({ level: "error", section: "meta", message: `Invalid supplier GSTIN: ${g.meta.gstin}` });
  if (!FP_RE.test(g.meta.fp)) issues.push({ level: "error", section: "meta", message: `Invalid period (FP) format: ${g.meta.fp}` });

  for (const inv of g.b2b) {
    if (!GSTIN_RE.test(inv.ctin)) issues.push({ level: "error", section: "b2b", message: `${inv.inum}: invalid recipient GSTIN ${inv.ctin}` });
    if (!POS_RE.test(inv.pos)) issues.push({ level: "error", section: "b2b", message: `${inv.inum}: invalid POS ${inv.pos}` });
    if (!inv.itms.length) issues.push({ level: "error", section: "b2b", message: `${inv.inum}: no tax lines` });
    const sumLine = inv.itms.reduce((a, x) => a + x.itm_det.txval + x.itm_det.iamt + x.itm_det.camt + x.itm_det.samt, 0);
    if (Math.abs(sumLine - inv.val) > 1) issues.push({ level: "warning", section: "b2b", message: `${inv.inum}: total ₹${inv.val} doesn't tie to line sum ₹${sumLine.toFixed(2)}` });
  }
  for (const inv of g.b2cl) {
    if (!POS_RE.test(inv.pos)) issues.push({ level: "error", section: "b2cl", message: `${inv.inum}: invalid POS ${inv.pos}` });
    if (inv.val <= 250000) issues.push({ level: "warning", section: "b2cl", message: `${inv.inum}: B2CL value ₹${inv.val} ≤ ₹2.5L` });
  }
  for (const g2 of g.b2cs) {
    if (!POS_RE.test(g2.pos)) issues.push({ level: "error", section: "b2cs", message: `Invalid POS ${g2.pos}` });
  }
  for (const e of g.exp) {
    if (e.exp_typ === "WPAY" && !e.itms.some((x) => x.iamt > 0)) {
      issues.push({ level: "warning", section: "exp", message: `${e.inum}: WPAY export has no IGST` });
    }
  }
  for (const n of g.cdnr) {
    if (!GSTIN_RE.test(n.ctin)) issues.push({ level: "error", section: "cdnr", message: `${n.nt_num}: invalid recipient GSTIN` });
  }
  return issues;
}

export function validateGstr3B(b: BuiltGstr3B): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!GSTIN_RE.test(b.meta.gstin)) issues.push({ level: "error", section: "meta", message: `Invalid GSTIN ${b.meta.gstin}` });
  if (!FP_RE.test(b.meta.fp)) issues.push({ level: "error", section: "meta", message: `Invalid period ${b.meta.fp}` });
  // Net ITC must not be negative
  const n = b.itc_elg.itc_net;
  if (n.iamt < 0 || n.camt < 0 || n.samt < 0) {
    issues.push({ level: "warning", section: "itc", message: `Net ITC negative — reversals exceed availed (I:${n.iamt} C:${n.camt} S:${n.samt})` });
  }
  for (const p of b.inter_sup.unreg_details) {
    if (!POS_RE.test(p.pos)) issues.push({ level: "error", section: "3.2", message: `Invalid POS ${p.pos}` });
  }
  // 3.2 IGST must not exceed 3.1(a) IGST
  const sum32 = b.inter_sup.unreg_details.reduce((a, x) => a + x.iamt, 0);
  if (sum32 - b.sup_details.osup_det.iamt > 1) {
    issues.push({ level: "warning", section: "3.2", message: `3.2 IGST ₹${sum32.toFixed(2)} exceeds 3.1(a) IGST ₹${b.sup_details.osup_det.iamt}` });
  }
  return issues;
}

// ───────────────────── Download helpers ─────────────────────

import { saveExport as _saveExport } from "./desktop-save";

export const downloadJson = (fileName: string, payload: unknown): void => {
  void _saveExport({
    subFolder: "GST",
    fileName,
    contents: JSON.stringify(payload, null, 2),
    mime: "application/json",
  });
};
