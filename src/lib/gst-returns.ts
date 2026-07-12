// GST Returns builder — full GSTR-1 (regular + amendments + EXP/NIL) and
// full GSTR-3B (3.1 a–e, 3.1.1, 3.2, 4 with reversal/ineligible, 5, 6.1).
// Output formats: GSTN portal JSON + GST Offline-Tool Excel sheets.
// All amounts internally in paise; converted to rupees (2dp) on output.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { XlsxSheet } from "@/lib/exporters";
import {
  readCompanies,
  readItems,
  readLedgers,
  readVoucherItemsForCompany,
  readVouchers,
  withCacheFallback,
} from "@/lib/offline/cache-read";

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
  itc_class?: "inputs" | "capital_goods" | "input_services" | "ineligible" | "na" | null;
  itc_eligible?: boolean | null;
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
  recipient_name: string;
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
  recipient_name: string;
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

type Gstr1ReconciliationData = Pick<
  BuiltGstr1,
  "b2b" | "b2ba" | "b2cl" | "b2cla" | "b2cs" | "cdnr" | "cdnra" | "cdnur" | "exp" | "nil" | "hsn_b2b" | "hsn_b2c"
>;

export interface Gstr1ReconciliationResult {
  b2b: { documentValue: number; hsnValue: number; documentTaxable: number; hsnTaxable: number };
  b2c: { documentValue: number; hsnValue: number; documentTaxable: number; hsnTaxable: number };
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
  // Indian FY quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar (of `year`).
  // `year` is treated as the calendar year that contains the quarter's months.
  const startMonth = q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1;
  const endMonth = startMonth + 2;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
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
itc_class, itc_eligible,
ledgers:party_ledger_id(name, gstin, state_code, gst_treatment, country),
voucher_items(qty, rate_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate,
items:item_id(name, hsn_code, unit))`;

export async function fetchVouchers(
  companyId: string,
  from: string,
  to: string,
  types: VoucherTypeEnum[],
): Promise<VoucherRow[]> {
  return withCacheFallback<VoucherRow[]>(
    async () => {
      const { data } = await supabase
        .from("vouchers")
        .select(SELECT)
        .eq("company_id", companyId)
        .in("voucher_type", types)
        .gte("voucher_date", from)
        .lte("voucher_date", to)
        .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true });
      return (data || []) as unknown as VoucherRow[];
    },
    async () => {
      const typeSet = new Set(types as unknown as string[]);
      const [vouchers, ledgers, items, viRows] = await Promise.all([
        readVouchers(companyId, { from, to }),
        readLedgers(companyId),
        readItems(companyId),
        readVoucherItemsForCompany(companyId),
      ]);
      const ledgerById = new Map((ledgers as any[]).map((l) => [String(l.id), l]));
      const itemById = new Map((items as any[]).map((i) => [String(i.id), i]));
      const viByVoucher = new Map<string, any[]>();
      for (const vi of viRows as any[]) {
        const key = String(vi.voucher_id);
        const list = viByVoucher.get(key) ?? [];
        list.push(vi);
        viByVoucher.set(key, list);
      }
      const filtered = (vouchers as any[]).filter((v) => typeSet.has(String(v.voucher_type)));
      const rows: VoucherRow[] = filtered.map((v) => {
        const l = v.party_ledger_id ? ledgerById.get(String(v.party_ledger_id)) : null;
        const lines = (viByVoucher.get(String(v.id)) ?? []).map((vi: any) => {
          const it = vi.item_id ? itemById.get(String(vi.item_id)) : null;
          return {
            qty: Number(vi.qty ?? 0),
            rate_paise: Number(vi.rate_paise ?? 0),
            taxable_paise: Number(vi.taxable_paise ?? 0),
            cgst_paise: Number(vi.cgst_paise ?? 0),
            sgst_paise: Number(vi.sgst_paise ?? 0),
            igst_paise: Number(vi.igst_paise ?? 0),
            gst_rate: Number(vi.gst_rate ?? 0),
            items: it ? { name: String(it.name ?? ""), hsn_code: it.hsn_code ?? null, unit: String(it.unit ?? "") } : null,
          };
        });
        return {
          id: String(v.id),
          voucher_date: String(v.voucher_date ?? ""),
          voucher_number: String(v.voucher_number ?? ""),
          voucher_type: String(v.voucher_type ?? ""),
          is_interstate: Boolean(v.is_interstate),
          place_of_supply_code: v.place_of_supply_code ?? null,
          reference_no: v.reference_no ?? null,
          vendor_invoice_no: v.vendor_invoice_no ?? null,
          vendor_invoice_date: v.vendor_invoice_date ?? null,
          reason: v.reason ?? null,
          original_voucher_id: v.original_voucher_id ?? null,
          subtotal_paise: Number(v.subtotal_paise ?? 0),
          cgst_paise: Number(v.cgst_paise ?? 0),
          sgst_paise: Number(v.sgst_paise ?? 0),
          igst_paise: Number(v.igst_paise ?? 0),
          total_paise: Number(v.total_paise ?? 0),
          supply_nature: (v.supply_nature ?? "taxable") as SupplyNature,
          shipping_bill_no: v.shipping_bill_no ?? null,
          shipping_bill_date: v.shipping_bill_date ?? null,
          port_code: v.port_code ?? null,
          is_amendment: Boolean(v.is_amendment),
          orig_invoice_no: v.orig_invoice_no ?? null,
          orig_invoice_date: v.orig_invoice_date ?? null,
          orig_period: v.orig_period ?? null,
          itc_class: v.itc_class ?? null,
          itc_eligible: v.itc_eligible ?? null,
          ledgers: l ? {
            name: String(l.name ?? ""),
            gstin: l.gstin ?? null,
            state_code: l.state_code ?? null,
            gst_treatment: (l.gst_treatment ?? "regular") as GstTreatment,
            country: l.country ?? null,
          } : null,
          voucher_items: lines,
        };
      });
      rows.sort((a, b) => a.voucher_date === b.voucher_date
        ? a.voucher_number.localeCompare(b.voucher_number)
        : a.voucher_date < b.voucher_date ? -1 : 1);
      return rows;
    },
  );
}

export async function fetchCompanyMeta(companyId: string): Promise<CompanyMeta> {
  return withCacheFallback<CompanyMeta>(
    async () => {
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
    },
    async () => {
      const rows = await readCompanies();
      const c = (rows as any[]).find((r) => String(r.id) === companyId);
      return {
        name: c?.name ?? "",
        gstin: c?.gstin ?? null,
        state_code: c?.state_code ?? null,
      };
    },
  );
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

const roundRupees = (value: number): number => Number(value.toFixed(2));
const taxLineTaxable = (lines: TaxLine[]): number => lines.reduce((sum, line) => sum + line.itm_det.txval, 0);
const nilGroupValue = (group: NilGroup): number => group.nil_amt + group.expt_amt + group.ngsup_amt;
const noteSign = (note: { ntty: "C" | "D" }): 1 | -1 => note.ntty === "C" ? -1 : 1;

export function getGstr1Reconciliation(g: Gstr1ReconciliationData): Gstr1ReconciliationResult {
  const registeredNil = g.nil.filter((row) => row.sply_ty.endsWith("B2B")).reduce((sum, row) => sum + nilGroupValue(row), 0);
  const unregisteredNil = g.nil.filter((row) => row.sply_ty.endsWith("B2C")).reduce((sum, row) => sum + nilGroupValue(row), 0);
  const registeredInvoices = [...g.b2b, ...g.b2ba];
  const unregisteredInvoices = [...g.b2cl, ...g.b2cla];
  const registeredNotes = [...g.cdnr, ...g.cdnra];

  const b2bDocumentTaxable = registeredInvoices.reduce((sum, inv) => sum + taxLineTaxable(inv.itms), 0)
    + registeredNil
    + registeredNotes.reduce((sum, note) => sum + noteSign(note) * taxLineTaxable(note.itms), 0);
  const b2bDocumentValue = registeredInvoices.reduce((sum, inv) => sum + inv.val, 0)
    + registeredNil
    + registeredNotes.reduce((sum, note) => sum + noteSign(note) * note.val, 0);

  const b2csTaxable = g.b2cs.reduce((sum, row) => sum + row.txval, 0);
  const b2csValue = g.b2cs.reduce(
    (sum, row) => sum + row.txval + row.iamt + row.camt + row.samt + row.csamt,
    0,
  );
  const b2cDocumentTaxable = unregisteredInvoices.reduce((sum, inv) => sum + taxLineTaxable(inv.itms), 0)
    + b2csTaxable
    + g.exp.reduce((sum, inv) => sum + inv.itms.reduce((lineSum, line) => lineSum + line.txval, 0), 0)
    + unregisteredNil
    + g.cdnur.reduce((sum, note) => sum + noteSign(note) * taxLineTaxable(note.itms), 0);
  const b2cDocumentValue = unregisteredInvoices.reduce((sum, inv) => sum + inv.val, 0)
    + b2csValue
    + g.exp.reduce((sum, inv) => sum + inv.val, 0)
    + unregisteredNil
    + g.cdnur.reduce((sum, note) => sum + noteSign(note) * note.val, 0);

  return {
    b2b: {
      documentValue: roundRupees(b2bDocumentValue),
      hsnValue: roundRupees(g.hsn_b2b.reduce((sum, row) => sum + row.val, 0)),
      documentTaxable: roundRupees(b2bDocumentTaxable),
      hsnTaxable: roundRupees(g.hsn_b2b.reduce((sum, row) => sum + row.txval, 0)),
    },
    b2c: {
      documentValue: roundRupees(b2cDocumentValue),
      hsnValue: roundRupees(g.hsn_b2c.reduce((sum, row) => sum + row.val, 0)),
      documentTaxable: roundRupees(b2cDocumentTaxable),
      hsnTaxable: roundRupees(g.hsn_b2c.reduce((sum, row) => sum + row.txval, 0)),
    },
  };
}

export function assertGstr1Reconciled(g: Gstr1ReconciliationData): void {
  const result = getGstr1Reconciliation(g);
  const mismatches = (["b2b", "b2c"] as const).flatMap((category) => {
    const row = result[category];
    return [
      ...(row.documentValue === row.hsnValue ? [] : [`${category.toUpperCase()} total value ${row.documentValue} ≠ HSN ${row.hsnValue}`]),
      ...(row.documentTaxable === row.hsnTaxable ? [] : [`${category.toUpperCase()} taxable value ${row.documentTaxable} ≠ HSN ${row.hsnTaxable}`]),
    ];
  });
  if (mismatches.length) throw new Error(`GSTR-1 reconciliation failed: ${mismatches.join("; ")}`);
}

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

  const accNil = (v: VoucherRow, natureOverride?: SupplyNature, sign: 1 | -1 = 1) => {
    const interstate = v.is_interstate;
    const partyGstin = v.ledgers?.gstin || "";
    const key: NilGroup["sply_ty"] = interstate
      ? (partyGstin ? "INTRB2B" : "INTRB2C")
      : (partyGstin ? "INTRAB2B" : "INTRAB2C");
    const cur = nilMap.get(key) ?? { sply_ty: key, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
    const amt = v.subtotal_paise || v.total_paise;
    const nature = natureOverride ?? v.supply_nature;
    if (nature === "nil_rated") cur.nil_amt += sign * amt;
    else if (nature === "exempt") cur.expt_amt += sign * amt;
    else if (nature === "non_gst") cur.ngsup_amt += sign * amt;
    nilMap.set(key, cur);
  };

  for (let v of sales) {

    let sn: SupplyNature = (v.supply_nature ?? "taxable") as SupplyNature;

    // Auto-classify: if user didn't explicitly mark the voucher as export/SEZ/etc.
    // AND every line is 0% GST with zero tax, treat the whole voucher as
    // nil-rated so it lands in the GSTR-1 "nil / exempt / non-GST" sheet
    // instead of B2B / B2CS. We also fire this for null/undefined supply_nature
    // (the Supabase read path can return null) and for the default "taxable".
    const isUnclassified = !sn || sn === "taxable";
    if (isUnclassified && v.voucher_items.length > 0) {
      const allZero = v.voucher_items.every(
        (it) => Number(it.gst_rate || 0) === 0
          && Number(it.cgst_paise || 0) === 0
          && Number(it.sgst_paise || 0) === 0
          && Number(it.igst_paise || 0) === 0,
      );
      // Also treat voucher-level zero tax as a safety net for older rows
      // where item-level tax fields may not have been backfilled.
      const voucherZeroTax = (v.cgst_paise || 0) === 0
        && (v.sgst_paise || 0) === 0
        && (v.igst_paise || 0) === 0;
      if (allZero && voucherZeroTax) sn = "nil_rated";
    }

    if (sn === "nil_rated" || sn === "exempt" || sn === "non_gst") {
      accNil(v, sn);
      continue;
    }

    // Partition line items on mixed-rate invoices: 0%-rate lines with zero tax
    // are nil-rated supplies and must land in the NIL sheet, NOT be listed as
    // a "0%" rate row inside a B2B / B2CS invoice (that misrepresents them as
    // zero-rated taxable supplies). The taxable portion of the same invoice
    // still flows to B2B / B2CL / B2CS below.
    const isNilLine = (it: VoucherRow["voucher_items"][number]) =>
      Number(it.gst_rate || 0) === 0
      && Number(it.igst_paise || 0) === 0
      && Number(it.cgst_paise || 0) === 0
      && Number(it.sgst_paise || 0) === 0;
    const partitionNilLines = sn !== "zero_rated_wp"
      && sn !== "zero_rated_wop"
      && !isExportTreatment(v.ledgers?.gst_treatment);
    const nilItems = partitionNilLines ? v.voucher_items.filter(isNilLine) : [];
    const taxableItems = partitionNilLines ? v.voucher_items.filter((it) => !isNilLine(it)) : v.voucher_items;
    let separatedNilPaise = 0;
    if (nilItems.length > 0) {
      const nilAmt = nilItems.reduce((s, it) => s + (it.taxable_paise || 0), 0);
      separatedNilPaise = nilAmt;
      if (nilAmt > 0) {
        const interstate = v.is_interstate;
        const partyGstin = v.ledgers?.gstin || "";
        const key: NilGroup["sply_ty"] = interstate
          ? (partyGstin ? "INTRB2B" : "INTRB2C")
          : (partyGstin ? "INTRAB2B" : "INTRAB2C");
        const cur = nilMap.get(key) ?? { sply_ty: key, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
        cur.nil_amt += nilAmt;
        nilMap.set(key, cur);
      }
      // Drop the nil lines so downstream B2B/B2CS aggregators don't emit a 0%
      // rate row. We shallow-clone the voucher to avoid mutating caller state.
      v = { ...v, voucher_items: taxableItems };
    }
    // If nothing taxable remains, the entire supply was nil — done.
    if (taxableItems.length === 0) continue;



    if (sn === "zero_rated_wp" || sn === "zero_rated_wop" || isExportTreatment(v.ledgers?.gst_treatment)) {
      const treatment = v.ledgers?.gst_treatment;
      // SEZ → goes to B2B with SEWP/SEWOP (per GSTN format)
      if (treatment === "sez_with_payment" || treatment === "sez_without_payment") {
        b2b.push({
          ctin: v.ledgers?.gstin || "",
          recipient_name: v.ledgers?.name || "",
          inum: v.voucher_number,
          idt: fmtDDMMYYYY(v.voucher_date),
          val: r(v.total_paise - separatedNilPaise),
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
        val: r(v.total_paise - separatedNilPaise),
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
        recipient_name: v.ledgers?.name || "",
        inum: v.voucher_number,
        idt: fmtDDMMYYYY(v.voucher_date),
        val: r(v.total_paise - separatedNilPaise),
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
          val: r(v.total_paise - separatedNilPaise),
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
          const lineTx = it.taxable_paise || 0;
          const lineTax = it.igst_paise + it.cgst_paise + it.sgst_paise;
          // Skip empty lines that would create a zero-value rate bucket.
          if (lineTx === 0 && lineTax === 0) continue;
          const key = `${interstate ? "INTER" : "INTRA"}|${pos}|${it.gst_rate}`;
          const cur = b2csMap.get(key) ?? {
            sply_ty: interstate ? "INTER" : "INTRA",
            pos: (pos || "").padStart(2, "0"),
            rt: it.gst_rate,
            txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0,
            typ: "OE",
          } satisfies B2CSGroup;
          cur.txval += lineTx;
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
  for (let v of creditNotes) {
    const ntty: "C" | "D" = v.voucher_type === "credit_note" ? "C" : "D";
    const pos = v.place_of_supply_code || v.ledgers?.state_code || compState;
    const partyGstin = v.ledgers?.gstin || "";
    const inv_typ = invTypeFromTreatment(v.ledgers?.gst_treatment);

    const noteNature = (v.supply_nature ?? "taxable") as SupplyNature;
    if (noteNature === "nil_rated" || noteNature === "exempt" || noteNature === "non_gst") {
      accNil(v, noteNature, ntty === "C" ? -1 : 1);
      continue;
    }

    // Same nil-line partition as the sales loop: strip 0%-and-zero-tax lines
    // from CDNR / CDNUR and add their taxable value to the NIL sheet (with the
    // sign flipped for credit notes so returns of nil-rated supplies net out).
    const isNilLine = (it: VoucherRow["voucher_items"][number]) =>
      Number(it.gst_rate || 0) === 0
      && Number(it.igst_paise || 0) === 0
      && Number(it.cgst_paise || 0) === 0
      && Number(it.sgst_paise || 0) === 0;
    const partitionNilLines = noteNature !== "zero_rated_wp"
      && noteNature !== "zero_rated_wop"
      && !isExportTreatment(v.ledgers?.gst_treatment);
    const nilItemsCN = partitionNilLines ? v.voucher_items.filter(isNilLine) : [];
    const taxableItemsCN = partitionNilLines ? v.voucher_items.filter((it) => !isNilLine(it)) : v.voucher_items;
    let separatedNilPaise = 0;
    if (nilItemsCN.length > 0) {
      const nilAmt = nilItemsCN.reduce((s, it) => s + (it.taxable_paise || 0), 0);
      separatedNilPaise = nilAmt;
      if (nilAmt > 0) {
        const interstate = v.is_interstate;
        const key: NilGroup["sply_ty"] = interstate
          ? (partyGstin ? "INTRB2B" : "INTRB2C")
          : (partyGstin ? "INTRAB2B" : "INTRAB2C");
        const cur = nilMap.get(key) ?? { sply_ty: key, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
        cur.nil_amt += (ntty === "C" ? -nilAmt : nilAmt);
        nilMap.set(key, cur);
      }
      v = { ...v, voucher_items: taxableItemsCN };
    }
    if (taxableItemsCN.length === 0) continue;


    if (partyGstin) {
      const note: CDNRInvoice = {
        ctin: partyGstin,
        recipient_name: v.ledgers?.name || "",
        nt_num: v.voucher_number,
        nt_dt: fmtDDMMYYYY(v.voucher_date),
        ntty,
        val: r(v.total_paise - separatedNilPaise),
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
          val: r(v.total_paise - separatedNilPaise),
          pos: (pos || "").padStart(2, "0"),
          itms: lineFromVoucherItems(v.voucher_items),
        });
      } else {
        const sign = ntty === "C" ? -1 : 1;
        for (const it of v.voucher_items) {
          const lineTx = it.taxable_paise || 0;
          const lineTax = it.igst_paise + it.cgst_paise + it.sgst_paise;
          if (lineTx === 0 && lineTax === 0) continue;
          const key = `${v.is_interstate ? "INTER" : "INTRA"}|${pos}|${it.gst_rate}`;
          const cur = b2csMap.get(key) ?? {
            sply_ty: v.is_interstate ? "INTER" : "INTRA",
            pos: (pos || "").padStart(2, "0"),
            rt: it.gst_rate,
            txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0,
            typ: "OE",
          } satisfies B2CSGroup;
          cur.txval += sign * lineTx;
          cur.iamt += sign * it.igst_paise;
          cur.camt += sign * it.cgst_paise;
          cur.samt += sign * it.sgst_paise;
          b2csMap.set(key, cur);
        }
      }
    }
  }

  // Safety net: nil / zero-rated supplies must NEVER land in B2CS. If any 0%
  // row leaked through (e.g. 1-paise rounding stub on an otherwise nil line),
  // drop it here — the value already sits in the NIL / Exempt sheet.
  const b2cs = Array.from(b2csMap.values())
    .filter((g) => Number(g.rt) > 0)
    .map((g) => ({
      ...g,
      txval: r(g.txval), iamt: r(g.iamt), camt: r(g.camt), samt: r(g.samt), csamt: r(g.csamt),
    }));

  // Same guard for B2B: drop any invoice whose every line is 0% with zero tax.
  const b2bClean = b2b.filter((inv) =>
    inv.itms.some((l) => Number(l.itm_det.rt) > 0 || (l.itm_det.iamt + l.itm_det.camt + l.itm_det.samt) > 0),
  );
  b2b.length = 0;
  b2b.push(...b2bClean);


  const nil = Array.from(nilMap.values()).map((g) => ({
    ...g, nil_amt: r(g.nil_amt), expt_amt: r(g.expt_amt), ngsup_amt: r(g.ngsup_amt),
  }));

  // HSN summary — split B2B (party has GSTIN) and B2C (no GSTIN / unregistered).
  // CRITICAL: HSN classification depends ONLY on whether the party is registered
  // (GSTIN present). It is INDEPENDENT of supply nature — exempt / nil-rated /
  // non-GST supplies to a B2B party still populate the B2B HSN map, and the
  // same value simultaneously flows to the exempt sheet. HSN totals therefore
  // equal Books' HSN report = taxable + exempt + nil + non-GST.
  const hsnB2BMap = new Map<string, HSNRow>();
  const hsnB2CMap = new Map<string, HSNRow>();
  const accumulate = (v: VoucherRow, sign: 1 | -1) => {
    const isB2B = !!(v.ledgers?.gstin && v.ledgers.gstin.trim());
    const map = isB2B ? hsnB2BMap : hsnB2CMap;
    const items = v.voucher_items || [];
    // Line count where taxable_paise is populated. When lines exist but every
    // taxable_paise is zero (common for exempt items where the accounting entry
    // only fills subtotal_paise), fall back to qty * rate_paise per line so the
    // HSN sheet still shows per-item detail (not a single collapsed row).
    const lineTaxableSum = items.reduce((s, it) => s + (it.taxable_paise || 0), 0);
    const needsFallback = items.length > 0 && lineTaxableSum === 0;
    if (items.length === 0) {
      const headerVal = v.subtotal_paise || v.total_paise;
      if (headerVal === 0) return;
      const key = `||0|OTH`;
      const cur = map.get(key) ?? {
        hsn_sc: "", desc: "", uqc: "OTH-OTH",
        qty: 0, rt: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, val: 0,
      } satisfies HSNRow;
      cur.txval += sign * headerVal;
      cur.val += sign * headerVal;
      map.set(key, cur);
      return;
    }
    for (const it of items) {
      const fallbackVal = needsFallback ? Math.round(Number(it.qty || 0) * Number(it.rate_paise || 0)) : 0;
      const lineTx = it.taxable_paise || fallbackVal;
      if (lineTx === 0 && it.igst_paise === 0 && it.cgst_paise === 0 && it.sgst_paise === 0) continue;
      const key = `${it.items?.hsn_code || ""}|${it.gst_rate}|${it.items?.unit || "OTH"}`;
      const cur = map.get(key) ?? {
        hsn_sc: it.items?.hsn_code || "",
        desc: it.items?.name || "",
        uqc: (it.items?.unit || "OTH").toUpperCase().slice(0, 3) + "-" + (it.items?.unit || "OTH").toUpperCase(),
        qty: 0, rt: it.gst_rate,
        txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, val: 0,
      } satisfies HSNRow;
      cur.qty += sign * Number(it.qty);
      cur.txval += sign * lineTx;
      cur.iamt += sign * it.igst_paise;
      cur.camt += sign * it.cgst_paise;
      cur.samt += sign * it.sgst_paise;
      cur.val += sign * (lineTx + it.cgst_paise + it.sgst_paise + it.igst_paise);
      map.set(key, cur);
    }
  };
  for (const v of sales) accumulate(v, 1);
  if (!iffOnly) for (const v of creditNotes) accumulate(v, v.voucher_type === "credit_note" ? -1 : 1);

  const finalizeHsn = (m: Map<string, HSNRow>): HSNRow[] =>
    Array.from(m.values()).map((h) => ({
      ...h,
      qty: Number(h.qty.toFixed(3)),
      txval: r(h.txval), iamt: r(h.iamt), camt: r(h.camt), samt: r(h.samt), val: r(h.val),
    }));
  const hsn_b2b = finalizeHsn(hsnB2BMap);
  const hsn_b2c = finalizeHsn(hsnB2CMap);

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
    b2b, b2ba, b2cl, b2cla, b2cs, cdnr, cdnra, cdnur, exp, nil, hsn_b2b, hsn_b2c, docs,
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
  return Array.from(m.entries()).map(([ctin, list]) => ({
    ctin,
    // Recipient name is an Excel-only convenience field and is not part of
    // the GSTN JSON invoice schema.
    [key]: list.map((item) => {
      const row = { ...item } as Record<string, unknown>;
      delete row.recipient_name;
      return row;
    }),
  }));
};

export function gstr1ToJson(g: BuiltGstr1): Record<string, unknown> {
  assertGstr1Reconciled(g);
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
  if (g.hsn_b2b.length || g.hsn_b2c.length) {
    out.hsn = {
      hsn_b2b: g.hsn_b2b.map((h, i) => ({ num: i + 1, ...h })),
      hsn_b2c: g.hsn_b2c.map((h, i) => ({ num: i + 1, ...h })),
    };
  }
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
  assertGstr1Reconciled(g);
  const headerRows = (extra: (string | number)[][]): (string | number)[][] => [
    ["Summary For GSTR-1"],
    [`GSTIN of Supplier: ${g.meta.gstin}`, `FP: ${g.meta.fp}`],
    [],
    ...extra,
  ];

  const b2bRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const inv of g.b2b) for (const it of inv.itms)
    b2bRows.push([inv.ctin, inv.recipient_name, inv.inum, inv.idt, inv.val, inv.pos, inv.rchrg, "", inv.inv_typ, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

  const b2baRows: (string | number)[][] = [
    ["GSTIN/UIN of Recipient", "Receiver Name", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Invoice Type", "Rate", "Taxable Value", "Cess Amount"],
  ];
  for (const inv of g.b2ba) for (const it of inv.itms)
    b2baRows.push([inv.ctin, inv.recipient_name, inv.oinum, inv.oidt, inv.inum, inv.idt, inv.val, inv.pos, inv.rchrg, inv.inv_typ, it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);

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

  const hsnHeader = ["HSN", "Description", "UQC", "Total Quantity", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount", "Total Value"];
  const hsnB2BRows: (string | number)[][] = [hsnHeader];
  for (const h of g.hsn_b2b) hsnB2BRows.push([h.hsn_sc, h.desc, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt, h.val]);
  const hsnB2CRows: (string | number)[][] = [hsnHeader];
  for (const h of g.hsn_b2c) hsnB2CRows.push([h.hsn_sc, h.desc, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt, h.val]);

  const docsRows: (string | number)[][] = [
    ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled", "Net Issued"],
  ];
  for (const d of g.docs) docsRows.push([d.doc_typ, d.from, d.to, d.totnum, d.cancel, d.net_issue]);

  // Header row inside every sheet is row index 3 (rows 0-2 hold the preamble).
  const AF = 3;
  const S = { autoFilterHeaderRow: AF, styling: "gstn" as const };
  return [
    { name: "b2b", rows: headerRows(b2bRows), ...S },
    { name: "b2ba", rows: headerRows(b2baRows), ...S },
    { name: "b2cl", rows: headerRows(b2clRows), ...S },
    { name: "b2cla", rows: headerRows(b2claRows), ...S },
    { name: "b2cs", rows: headerRows(b2csRows), ...S },
    { name: "cdnr", rows: headerRows(cdnrRows), ...S },
    { name: "cdnra", rows: headerRows(cdnraRows), ...S },
    { name: "cdnur", rows: headerRows(cdnurRows), ...S },
    { name: "exp", rows: headerRows(expRows), ...S },
    { name: "nil", rows: headerRows(nilRows), ...S },
    { name: "hsn_b2b", rows: headerRows(hsnB2BRows), ...S },
    { name: "hsn_b2c", rows: headerRows(hsnB2CRows), ...S },
    { name: "docs", rows: headerRows(docsRows), ...S },
  ];
}

// ───────────────────── GSTR-3B builder ─────────────────────

export interface BuiltGstr3B {
  meta: { gstin: string; fp: string; from: string; to: string; legal_name?: string };
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
  /** Information-only breakup of "Other ITC" by class (for GSTR-9 table 6 & UI). */
  itc_class_breakup: {
    inputs:         { iamt: number; camt: number; samt: number; csamt: number; txval: number };
    capital_goods:  { iamt: number; camt: number; samt: number; csamt: number; txval: number };
    input_services: { iamt: number; camt: number; samt: number; csamt: number; txval: number };
    ineligible_blocked: { iamt: number; camt: number; samt: number; csamt: number; txval: number };
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
  // Vouchers flagged itc_eligible=false or itc_class='ineligible' flow to 4(D) instead.
  const itcAll = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const itcRcm = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const zeroClass = () => ({ iamt: 0, camt: 0, samt: 0, csamt: 0, txval: 0 });
  const cb = {
    inputs: zeroClass(),
    capital_goods: zeroClass(),
    input_services: zeroClass(),
    ineligible_blocked: zeroClass(),
  };
  const isBlocked = (v: VoucherRow) =>
    v.itc_eligible === false || v.itc_class === "ineligible";
  const classOf = (v: VoucherRow): keyof typeof cb => {
    if (isBlocked(v)) return "ineligible_blocked";
    if (v.itc_class === "capital_goods") return "capital_goods";
    if (v.itc_class === "input_services") return "input_services";
    // default — treat unclassified as inputs (preserves legacy behaviour)
    return "inputs";
  };
  for (const v of purchases) {
    const klass = classOf(v);
    cb[klass].iamt += v.igst_paise; cb[klass].camt += v.cgst_paise;
    cb[klass].samt += v.sgst_paise; cb[klass].txval += v.subtotal_paise;
    if (klass === "ineligible_blocked") continue; // routed to 4(D)
    if (v.supply_nature === "rcm_inward") {
      itcRcm.iamt += v.igst_paise; itcRcm.camt += v.cgst_paise; itcRcm.samt += v.sgst_paise;
    } else {
      itcAll.iamt += v.igst_paise; itcAll.camt += v.cgst_paise; itcAll.samt += v.sgst_paise;
    }
  }
  for (const v of debitNotes) if (v.voucher_type === "debit_note") {
    if (isBlocked(v)) {
      cb.ineligible_blocked.iamt += v.igst_paise; cb.ineligible_blocked.camt += v.cgst_paise;
      cb.ineligible_blocked.samt += v.sgst_paise; cb.ineligible_blocked.txval += v.subtotal_paise;
      continue;
    }
    const klass = classOf(v);
    cb[klass].iamt += v.igst_paise; cb[klass].camt += v.cgst_paise;
    cb[klass].samt += v.sgst_paise; cb[klass].txval += v.subtotal_paise;
    itcAll.iamt += v.igst_paise; itcAll.camt += v.cgst_paise; itcAll.samt += v.sgst_paise;
  }
  for (const v of creditNotes) if (v.voucher_type === "credit_note") {
    if (isBlocked(v)) continue;
    const klass = classOf(v);
    cb[klass].iamt -= v.igst_paise; cb[klass].camt -= v.cgst_paise;
    cb[klass].samt -= v.sgst_paise; cb[klass].txval -= v.subtotal_paise;
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

  // 4(D) ineligible — merge manual rows with auto-detected blocked vouchers
  const itc_inelg = (args.itcInelig || []).map((x) => ({
    ty: x.ty === "RUL_42_43" ? "RUL" : "OTH",
    iamt: x.iamt, camt: x.camt, samt: x.samt, csamt: x.csamt,
  }));
  if (cb.ineligible_blocked.iamt || cb.ineligible_blocked.camt || cb.ineligible_blocked.samt) {
    itc_inelg.push({
      ty: "OTH",
      iamt: r(cb.ineligible_blocked.iamt),
      camt: r(cb.ineligible_blocked.camt),
      samt: r(cb.ineligible_blocked.samt),
      csamt: 0,
    });
  }

  const itc_class_breakup = {
    inputs:         { iamt: r(cb.inputs.iamt), camt: r(cb.inputs.camt), samt: r(cb.inputs.samt), csamt: 0, txval: r(cb.inputs.txval) },
    capital_goods:  { iamt: r(cb.capital_goods.iamt), camt: r(cb.capital_goods.camt), samt: r(cb.capital_goods.samt), csamt: 0, txval: r(cb.capital_goods.txval) },
    input_services: { iamt: r(cb.input_services.iamt), camt: r(cb.input_services.camt), samt: r(cb.input_services.samt), csamt: 0, txval: r(cb.input_services.txval) },
    ineligible_blocked: { iamt: r(cb.ineligible_blocked.iamt), camt: r(cb.ineligible_blocked.camt), samt: r(cb.ineligible_blocked.samt), csamt: 0, txval: r(cb.ineligible_blocked.txval) },
  };

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
    meta: { gstin: company.gstin || "", fp, from, to, legal_name: company.name },
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
    itc_class_breakup,
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
  const fpLabel = (() => {
    const m = b.meta.fp;
    const mon = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m.slice(0, 2))] || m.slice(0, 2);
    return `${mon} ${m.slice(2)}`;
  })();
  // Layout mirrors the official "GSTR3B Excel Utility" worksheet (rule 61(5)),
  // including header block, sections 3.1, 3.1.1, 4 (with sub-rows), 5, 5.1
  // and Table 3.2 placed at the bottom (as per the GSTN utility).
  const sup_eco = b.sup_eco ?? { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const itc = b.itc_elg;
  const find = (arr: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[], ty: string) =>
    arr.find((x) => x.ty === ty) ?? { ty, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const impg = find(itc.itc_avl, "IMPG");
  const imps = find(itc.itc_avl, "IMPS");
  const isrc = find(itc.itc_avl, "ISRC");
  const isd  = find(itc.itc_avl, "ISD");
  const oth  = find(itc.itc_avl, "OTH");
  const revR = find(itc.itc_rev, "RUL");
  const revO = find(itc.itc_rev, "OTH");
  const inelgRcl = find(itc.itc_inelg, "RUL");
  const inelgOth = find(itc.itc_inelg, "OTH");
  const inwGst = b.inward_sup.isup_details.find((x) => x.ty === "GST") ?? { ty: "GST", inter: 0, intra: 0 };
  const inwNon = b.inward_sup.isup_details.find((x) => x.ty === "NONGST") ?? { ty: "NONGST", inter: 0, intra: 0 };

  const tot31Tx = s.osup_det.txval + s.osup_zero.txval + s.osup_nil_exmp.txval + s.isup_rev.txval + s.osup_nongst.txval;
  const tot31I  = s.osup_det.iamt + s.osup_zero.iamt + s.isup_rev.iamt;
  const tot31C  = s.osup_det.camt + s.isup_rev.camt;
  const tot31S  = s.osup_det.samt + s.isup_rev.samt;
  const tot31Cs = s.osup_det.csamt + s.osup_zero.csamt + s.isup_rev.csamt;

  const summary: (string | number)[][] = [
    ["GSTR-3B"],
    ["[See rule 61(5)]"],
    [],
    ["GSTIN", b.meta.gstin, "", "Year", b.meta.fp.slice(2)],
    ["Legal name of the registered person", b.meta.legal_name || "", "", "Month", fpLabel],
    [],
    ["3.1 Details of Outward Supplies and inward supplies liable to reverse charge"],
    ["Nature of Supplies", "Total Taxable value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["1", "2", "3", "4", "5", "6"],
    ["(a) Outward Taxable  supplies  (other than zero rated, nil rated and exempted)", s.osup_det.txval, s.osup_det.iamt, s.osup_det.camt, s.osup_det.samt, s.osup_det.csamt],
    ["(b) Outward Taxable  supplies  (zero rated )", s.osup_zero.txval, s.osup_zero.iamt, "", "", s.osup_zero.csamt],
    ["(c) Other Outward Taxable  supplies (Nil rated, exempted)", s.osup_nil_exmp.txval, "", "", "", ""],
    ["(d) Inward supplies (liable to reverse charge)", s.isup_rev.txval, s.isup_rev.iamt, s.isup_rev.camt, s.isup_rev.samt, s.isup_rev.csamt],
    ["(e) Non-GST Outward supplies", s.osup_nongst.txval, "", "", "", ""],
    ["Total", tot31Tx, tot31I, tot31C, tot31S, tot31Cs],
    [],
    ["3.1.1 Details of supplies notified under section 9(5) of the CGST Act, 2017 and corresponding provisions in IGST/UTGST/SGST Acts"],
    ["Nature of Supplies", "Total Taxable value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["1", "2", "3", "4", "5", "6"],
    ["(i) Taxable supplies on which electronic commerce operator pays tax u/s 9(5) [to be furnished by electronic commerce operator]", sup_eco.txval, sup_eco.iamt, sup_eco.camt, sup_eco.samt, sup_eco.csamt],
    ["(ii) Taxable supplies made by registered person through electronic commerce operator, on which electronic commerce operator is required to pay tax u/s 9(5) [to be furnished by registered person making supplies through electronic commerce operator]", 0, 0, 0, 0, 0],
    [],
    ["4. Eligible ITC"],
    ["Details", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["1", "2", "3", "4", "5"],
    ["(A) ITC Available (Whether in full or part)", "", "", "", ""],
    ["(1)   Import of goods", impg.iamt, "", "", impg.csamt],
    ["(2)   Import of services", imps.iamt, "", "", imps.csamt],
    ["(3)   Inward supplies liable to reverse charge (other than 1 & 2 above)", isrc.iamt, isrc.camt, isrc.samt, isrc.csamt],
    ["(4)   Inward supplies from ISD", isd.iamt, isd.camt, isd.samt, isd.csamt],
    ["(5)   All other ITC", oth.iamt, oth.camt, oth.samt, oth.csamt],
    ["(B) ITC Reversed", "", "", "", ""],
    ["(1) As per rules 38, 42 & 43 of CGST Rules and section 17(5)", revR.iamt, revR.camt, revR.samt, revR.csamt],
    ["(2)   Others", revO.iamt, revO.camt, revO.samt, revO.csamt],
    ["(C) Net ITC Available (A)-(B)", itc.itc_net.iamt, itc.itc_net.camt, itc.itc_net.samt, itc.itc_net.csamt],
    ["(D) Other Details", "", "", "", ""],
    ["(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", inelgRcl.iamt, inelgRcl.camt, inelgRcl.samt, inelgRcl.csamt],
    ["(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", inelgOth.iamt, inelgOth.camt, inelgOth.samt, inelgOth.csamt],
    [],
    ["5. Values of exempt, Nil-rated and non-GST inward supplies"],
    ["Nature of supplies", "Inter-State supplies", "Intra-state supplies"],
    ["1", "2", "3"],
    ["From a supplier under composition scheme, Exempt  and Nil rated supply", inwGst.inter, inwGst.intra],
    ["Non GST supply", inwNon.inter, inwNon.intra],
    ["Total", inwGst.inter + inwNon.inter, inwGst.intra + inwNon.intra],
    [],
    ["5.1 Interest & late fee payable"],
    ["Description", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["1", "2", "3", "4", "5"],
    ["Interest", 0, 0, 0, 0],
    [],
    ["3.2  Of the supplies shown in 3.1 (a), details of inter-state supplies made to unregistered persons, composition taxable person and UIN holders"],
    ["Place of Supply(State/UT)", "Supplies made to Unregistered Persons", "", "Supplies made to Composition Taxable Persons", "", "Supplies made to UIN holders", ""],
    ["", "Total Taxable value", "Amount of Integrated Tax", "Total Taxable value", "Amount of Integrated Tax", "Total Taxable value", "Amount of Integrated Tax"],
    ["1", "2", "3", "4", "5", "6", "7"],
    ...b.inter_sup.unreg_details.map((p) => [p.pos, p.txval, p.iamt, "", "", "", ""] as (string | number)[]),
    ["Total",
      b.inter_sup.unreg_details.reduce((a, x) => a + x.txval, 0),
      b.inter_sup.unreg_details.reduce((a, x) => a + x.iamt, 0),
      0, 0, 0, 0,
    ],
    [],
    ["6.1 Payment of tax"],
    ["Description", "Total tax payable", "Tax paid through ITC — IGST", "CGST", "SGST/UTGST", "Cess", "Tax paid TDS./TCS", "Tax/Cess paid in cash", "Interest", "Late Fee"],
    ["Integrated Tax", b.tax_pmt.iamt, 0, 0, 0, 0, 0, b.tax_pmt.iamt_payable, 0, 0],
    ["Central Tax", b.tax_pmt.camt, 0, 0, 0, 0, 0, b.tax_pmt.camt_payable, 0, 0],
    ["State/UT Tax", b.tax_pmt.samt, 0, 0, 0, 0, 0, b.tax_pmt.samt_payable, 0, 0],
    ["Cess", 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [],
    ["Verification (by Authorized signatory)"],
    ["I hereby solemnly affirm and declare that the information given herein above is true and correct to the best of my knowledge and belief and nothing has been concealed therefrom."],
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
