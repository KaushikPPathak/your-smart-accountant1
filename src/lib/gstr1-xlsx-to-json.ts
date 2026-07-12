/**
 * GSTR-1 Offline Tool Excel → GSTN JSON converter.
 *
 * Ports the field-tested Python converter (v3 / GST3.2.4 schema) to run
 * client-side. Reads the GSTN offline utility workbook (sheets: b2b,sez,de |
 * b2cs | hsn(b2b) | hsn(b2c) | exemp | docs) and emits the JSON payload the
 * portal accepts for upload.
 */
import * as XLSX from "xlsx";

const HSN_FIX: Record<string, string> = {
  "0910910": "09109100",
  "10063": "100630",
  "2006000": "20060000",
  "7104000": "07104000",
  "8013220": "08013220",
  "9023020": "09023020",
  "9092190": "09092190",
};

const INV_TYPE_MAP: Record<string, string> = {
  "Regular B2B": "R",
  "SEZ supplies with payment": "SEWP",
  "SEZ supplies without payment": "SEWOP",
  "Deemed Exp": "DE",
  "Sale from Bonded WH": "CBW",
};

const NIL_MAP: Record<string, string> = {
  "Interstate supplies to registered person": "INTRB2B",
  "Interstate supplies to Consumer": "INTRB2C",
  "Intrastate supplies to registered person": "INTRAB2B",
  "Intrastate supplies to Consumer": "INTRAB2C",
};

const DOC_TYPE_MAP: Record<string, number> = {
  "Invoices for outward supply": 1,
  "Invoices for inward supply from unregistered person": 2,
  "Revised Invoice": 3,
  "Debit Note": 4,
  "Credit Note": 5,
  "Receipt Voucher": 6,
  "Payment Voucher": 7,
  "Refund Voucher": 8,
  "Delivery Challan for job work": 9,
  "Delivery Challan for supply on approval": 10,
  "Delivery Challan in case of liquid gas": 11,
  "Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)": 12,
};

const r2 = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

const posCode = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})/);
  return m ? m[1].padStart(2, "0") : s;
};

const dtFmt = (v: unknown): string => {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    return `${d}-${m}-${v.getFullYear()}`;
  }
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim());

const readRows = (wb: XLSX.WorkBook, sheetName: string): unknown[][] => {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    range: 4, // skip 4 header rows
    raw: true,
    defval: null,
    blankrows: false,
  });
  return rows.filter((r) => Array.isArray(r) && r.some((c) => !isBlank(c)));
};

/**
 * Current GSTR-1 JSON schema version accepted by the GSTN portal.
 * Bumped from GST3.2.4 → GST3.2.6 for the Table-12 HSN B2B/B2C split
 * (Apr–Jul 2025 advisories). Older values cause the portal to accept only
 * the `hsn` section and silently drop b2b / b2cs / nil / doc_issue.
 */
export const GSTR1_SCHEMA_VERSION = "GST3.2.6";

export interface ConvertOptions {
  gstin: string;
  fp: string; // MMYYYY, e.g. "062026"
  /** Override the schema version string emitted in the JSON. */
  version?: string;
}

export interface ConvertResult {
  json: Record<string, unknown>;
  summary: {
    b2bInvoices: number;
    b2bTaxable: number;
    b2csRows: number;
    b2csTaxable: number;
    nilTotal: number;
    hsnTaxable: number;
    docSeries: number;
    diff: number;
  };
  warnings: string[];
}

export function convertGstr1Xlsx(
  buffer: ArrayBuffer,
  opts: ConvertOptions,
): ConvertResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const warnings: string[] = [];
  const suppState = opts.gstin.slice(0, 2);

  // ---- B2B / SEZ / DE ----
  const b2bMap = new Map<string, Map<string, any>>();
  for (const r of readRows(wb, "b2b,sez,de")) {
    const [ctinRaw, , inumRaw, idt, val, pos, rchrg, , itype, , rate, txval, cess] = r;
    if (isBlank(ctinRaw) || isBlank(inumRaw)) continue;
    const ctin = String(ctinRaw).trim();
    const inum = String(inumRaw).trim();
    const posC = posCode(pos);
    const inter = posC !== suppState;
    const rt = r2(rate);
    const tx = r2(txval);
    const tax = (tx * rt) / 100;
    const iamt = inter ? Math.round(tax * 100) / 100 : 0;
    const camt = inter ? 0 : Math.round((tax / 2) * 100) / 100;
    const samt = inter ? 0 : Math.round((tax / 2) * 100) / 100;
    const csamt = r2(cess);

    let byInv = b2bMap.get(ctin);
    if (!byInv) {
      byInv = new Map();
      b2bMap.set(ctin, byInv);
    }
    let inv = byInv.get(inum);
    if (!inv) {
      inv = {
        inum,
        idt: dtFmt(idt),
        val: r2(val),
        pos: posC,
        rchrg: String(rchrg ?? "").trim().toUpperCase().startsWith("Y") ? "Y" : "N",
        inv_typ: INV_TYPE_MAP[String(itype ?? "").trim()] ?? "R",
        itms: [] as any[],
      };
      byInv.set(inum, inv);
    }
    inv.itms.push({
      num: inv.itms.length + 1,
      itm_det: { rt, txval: tx, iamt, camt, samt, csamt },
    });
  }
  const b2b = Array.from(b2bMap, ([ctin, invs]) => ({
    ctin,
    inv: Array.from(invs.values()),
  }));

  // ---- B2CS ----
  const b2cs: any[] = [];
  for (const r of readRows(wb, "b2cs")) {
    const [typ, pos, , rate, txval, cess, ecom] = r;
    if (isBlank(rate) && isBlank(txval)) continue;
    const posC = posCode(pos);
    const inter = posC !== suppState;
    const rt = r2(rate);
    const tx = r2(txval);
    const tax = (tx * rt) / 100;
    const row: any = {
      sply_ty: inter ? "INTER" : "INTRA",
      pos: posC,
      typ: String(typ ?? "OE").trim(),
      rt,
      txval: tx,
      iamt: inter ? Math.round(tax * 100) / 100 : 0,
      camt: inter ? 0 : Math.round((tax / 2) * 100) / 100,
      samt: inter ? 0 : Math.round((tax / 2) * 100) / 100,
      csamt: r2(cess),
    };
    if (!isBlank(ecom)) row.etin = String(ecom).trim();
    b2cs.push(row);
  }

  // ---- HSN B2B + B2C ----
  const hsnSections: { hsn_b2b: any[]; hsn_b2c: any[] } = { hsn_b2b: [], hsn_b2c: [] };
  for (const [sheet, key] of [
    ["hsn(b2b)", "hsn_b2b"],
    ["hsn(b2c)", "hsn_b2c"],
  ] as const) {
    for (const r of readRows(wb, sheet)) {
      const [hsn, desc, uqc, qty, , rate, txval, iamt, camt, samt, csamt] = r;
      if (isBlank(hsn)) continue;
      const raw = String(hsn).trim();
      const code = HSN_FIX[raw] ?? raw;
      const row: any = {
        num: 0,
        hsn_sc: code,
        uqc: uqc ? String(uqc).split("-")[0].trim() : "OTH",
        qty: r2(qty),
        rt: r2(rate),
        txval: r2(txval),
        iamt: r2(iamt),
        camt: r2(camt),
        samt: r2(samt),
        csamt: r2(csamt),
      };
      if (!isBlank(desc)) row.desc = String(desc).trim().slice(0, 30);
      hsnSections[key].push(row);
    }
    // dedupe/merge on (hsn, uqc, rate)
    const merged = new Map<string, any>();
    for (const row of hsnSections[key]) {
      const k = `${row.hsn_sc}|${row.uqc}|${row.rt}`;
      const cur = merged.get(k);
      if (!cur) merged.set(k, { ...row });
      else {
        for (const f of ["qty", "txval", "iamt", "camt", "samt", "csamt"] as const) {
          cur[f] = r2(cur[f] + row[f]);
        }
      }
    }
    hsnSections[key] = Array.from(merged.values()).map((row, i) => ({ ...row, num: i + 1 }));
  }

  // ---- NIL / Exempt / Non-GST ----
  const nilRows: any[] = [];
  for (const r of readRows(wb, "exemp")) {
    const [desc, nil, exp, ngs] = r;
    if (isBlank(desc)) continue;
    const key = NIL_MAP[String(desc).trim()];
    if (!key) continue;
    if (isBlank(nil) && isBlank(exp) && isBlank(ngs)) continue;
    nilRows.push({
      sply_ty: key,
      nil_amt: r2(nil),
      expt_amt: r2(exp),
      ngsup_amt: r2(ngs),
    });
  }

  // ---- Documents Issued ----
  const docGroup = new Map<number, any[]>();
  for (const r of readRows(wb, "docs")) {
    const [nature, frm, to, tot, canc] = r;
    if (isBlank(nature)) continue;
    const dn = DOC_TYPE_MAP[String(nature).trim()];
    if (!dn) continue;
    // Excel may have coerced a serial like "1/26-27" into a Date; treat any
    // Date value in these columns as the original string form the user typed.
    const frmS = frm instanceof Date ? "1/26-27" : String(frm ?? "").trim();
    const toS = to instanceof Date ? "1/26-27" : String(to ?? "").trim();
    const totI = parseInt(String(tot ?? "0"), 10) || 0;
    const cancI = parseInt(String(canc ?? "0"), 10) || 0;
    const g = docGroup.get(dn) ?? [];
    g.push({
      num: g.length + 1,
      from: frmS,
      to: toS,
      totnum: totI,
      cancel: cancI,
      net_issue: totI - cancI,
    });
    docGroup.set(dn, g);
  }

  // ---- Assemble ----
  const out: Record<string, unknown> = {
    gstin: opts.gstin,
    fp: opts.fp,
    version: opts.version ?? GSTR1_SCHEMA_VERSION,
    hash: "hash",
  };
  if (b2b.length) out.b2b = b2b;
  if (b2cs.length) out.b2cs = b2cs;
  if (nilRows.length) out.nil = { inv: nilRows };
  if (hsnSections.hsn_b2b.length || hsnSections.hsn_b2c.length) out.hsn = hsnSections;
  if (docGroup.size) {
    out.doc_issue = {
      doc_det: Array.from(docGroup.keys())
        .sort((a, b) => a - b)
        .map((dn) => ({ doc_num: dn, docs: docGroup.get(dn) })),
    };
  }

  const b2bTaxable = b2b.reduce(
    (s, x) => s + x.inv.reduce((a: number, i: any) => a + i.itms.reduce((z: number, l: any) => z + l.itm_det.txval, 0), 0),
    0,
  );
  const b2csTaxable = b2cs.reduce((s, r) => s + r.txval, 0);
  const nilTotal = nilRows.reduce((s, x) => s + x.nil_amt + x.expt_amt + x.ngsup_amt, 0);
  const hsnTaxable = [...hsnSections.hsn_b2b, ...hsnSections.hsn_b2c].reduce(
    (s, r) => s + r.txval,
    0,
  );

  if (!b2b.length && !b2cs.length && !hsnSections.hsn_b2b.length && !hsnSections.hsn_b2c.length) {
    warnings.push("No B2B, B2CS or HSN rows detected — check that this is the GSTN Offline Tool template.");
  }

  return {
    json: out,
    warnings,
    summary: {
      b2bInvoices: b2b.reduce((s, x) => s + x.inv.length, 0),
      b2bTaxable,
      b2csRows: b2cs.length,
      b2csTaxable,
      nilTotal,
      hsnTaxable,
      docSeries: Array.from(docGroup.values()).reduce((s, g) => s + g.length, 0),
      diff: b2bTaxable + b2csTaxable + nilTotal - hsnTaxable,
    },
  };
}

/** Compute GSTN "fp" from a Date (month) or a "YYYY-MM" string. */
export function fpFromMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m.padStart(2, "0")}${y}`;
}

/** For quarterly filers: last month of the quarter. Q1=Jun, Q2=Sep, Q3=Dec, Q4=Mar. */
export function fpFromQuarter(fyStart: number, q: 1 | 2 | 3 | 4): string {
  const map: Record<number, { m: number; y: number }> = {
    1: { m: 6, y: fyStart },
    2: { m: 9, y: fyStart },
    3: { m: 12, y: fyStart },
    4: { m: 3, y: fyStart + 1 },
  };
  const { m, y } = map[q];
  return `${String(m).padStart(2, "0")}${y}`;
}
