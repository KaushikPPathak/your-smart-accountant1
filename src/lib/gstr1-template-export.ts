// GSTR-1 export using the OFFICIAL GSTN Offline-Tool Excel template.
// The template ships as a CDN asset (see src/assets/gstr1_template.xlsx.asset.json)
// and every sheet — colours, drop-downs (data validations), summary formulas,
// column widths, freeze panes — is preserved exactly. We ONLY inject data rows
// starting at row 5 of each mapped sheet. Sheets we don't compute (amendments,
// advances, e-commerce operator) are left blank but still delivered so the
// workbook matches the GSTN template shape 1-for-1.

import { assertGstr1Reconciled, type BuiltGstr1 } from "@/lib/gst-returns";
import { saveExport } from "@/lib/desktop-save";

// Map POS state code ("07") to the master-sheet POS label ("07-Delhi").
// The GSTN template drop-down uses the "NN-State" form; using just "07"
// would trigger data-validation warnings in Excel.
const STATE_NAMES: Record<string, string> = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh",
  "05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh",
  "10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur",
  "15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
  "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat",
  "25":"Daman & Diu","26":"Dadra & Nagar Haveli and Daman & Diu","27":"Maharashtra",
  "28":"Andhra Pradesh (Old)","29":"Karnataka","30":"Goa","31":"Lakshadweep",
  "32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman & Nicobar Islands",
  "36":"Telangana","37":"Andhra Pradesh","38":"Ladakh","96":"Other Country","97":"Other Territory",
};
const posLabel = (code: string | number): string => {
  const s = String(code ?? "").padStart(2, "0");
  const name = STATE_NAMES[s];
  return name ? `${s}-${name}` : s;
};

const NIL_DESC: Record<string, string> = {
  INTRB2B:  "Inter-State supplies to registered persons",
  INTRAB2B: "Intra-State supplies to registered persons",
  INTRB2C:  "Inter-State supplies to unregistered persons",
  INTRAB2C: "Intra-State supplies to unregistered persons",
};

// The official template is bundled in /public so the installed desktop app
// never depends on the network. Keep one in-memory copy for repeated exports.
let TEMPLATE_MEM: ArrayBuffer | null = null;

function isValidXlsx(b: ArrayBuffer): boolean {
  if (b.byteLength < 10000) return false;
  const h = new Uint8Array(b, 0, 4);
  return h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
}

async function fetchTemplateBuffer(): Promise<ArrayBuffer> {
  if (TEMPLATE_MEM && isValidXlsx(TEMPLATE_MEM)) return TEMPLATE_MEM;
  const response = await fetch("/gstr1_template.xlsx", { cache: "force-cache" });
  if (!response.ok) throw new Error(`Bundled GSTR-1 template unavailable (HTTP ${response.status})`);
  const buffer = await response.arrayBuffer();
  if (!isValidXlsx(buffer)) throw new Error("Bundled GSTR-1 template is invalid");
  TEMPLATE_MEM = buffer;
  return buffer;
}

/** Fire-and-forget prefetch — call on GSTR-1 page mount so the template is
 * cached in IndexedDB before the user clicks Export. Silent on failure. */
export function prefetchGstr1Template(): void {
  void fetchTemplateBuffer().catch(() => { /* export reports the error if needed */ });
}

type TemplateRows = Record<string, (string | number)[][]>;
// Row-3 total cells that must dedup a repeated invoice-value column.
// Invoice Value is a property of the invoice, not the rate row — we repeat
// it on every rate line for user clarity but the row-3 total must count
// each invoice once, keyed by its unique invoice number column.
export type DedupTotalConfig = { valCol: string; invCol: string };
type DedupTotals = Record<string, DedupTotalConfig>;

function writeTemplateInWorker(
  template: ArrayBuffer,
  sheets: TemplateRows,
  dedupTotals: DedupTotals,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/gstr1-template.worker.ts", import.meta.url), { type: "module" });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Official workbook generation timed out"));
    }, 30000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; output?: Uint8Array; error?: string }>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (!event.data.ok || !event.data.output) reject(new Error(event.data.error || "Workbook generation failed"));
      else resolve(event.data.output.buffer as ArrayBuffer);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "Workbook worker failed"));
    };
    const workerCopy = template.slice(0);
    worker.postMessage({ template: workerCopy, sheets, dedupTotals }, [workerCopy]);
  });
}

export async function exportGstr1UsingOfficialTemplate(
  g: BuiltGstr1,
  fileName: string,
  subFolder = "Reports",
): Promise<void> {
  // Never produce a workbook GSTN will reject because document-wise and HSN
  // B2B/B2C Total Value or Taxable Value summaries do not tally.
  assertGstr1Reconciled(g);
  const buf = await fetchTemplateBuffer();
  const sheets: TemplateRows = {};
  const writeRows = (sheetName: string, rows: (string | number)[][]) => { sheets[sheetName] = rows; };

  // ── b2b,sez,de ────────────────────────────────────────────────
  // Template row-3 formulas: A3/C3 use SUMPRODUCT+COUNTIF (dedup safely on
  // repeated GSTIN / Invoice#); E3 "Total Invoice Value" is a plain SUM, so
  // Invoice Value MUST appear only on the FIRST rate line of a multi-rate
  // invoice — otherwise it gets counted once per rate line. All other
  // identifying columns are repeated on every rate line so the sheet reads
  // cleanly (no visually blank rows).
  const b2bRows: (string | number)[][] = [];
  for (const inv of g.b2b) {
    inv.itms.forEach((it, idx) => {
      const first = idx === 0;
      b2bRows.push([
        inv.ctin, inv.recipient_name,
        inv.inum, inv.idt,
        first ? inv.val : "", posLabel(inv.pos),
        inv.rchrg, "",
        inv.inv_typ === "R" ? "Regular B2B" : inv.inv_typ,
        "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
      ]);
    });
  }
  writeRows("b2b,sez,de", b2bRows);

  // ── b2ba ──────────────────────────────────────────────────────
  const b2baRows: (string | number)[][] = [];
  for (const inv of g.b2ba) {
    for (const it of inv.itms) {
      b2baRows.push([
        inv.ctin, inv.recipient_name,
        inv.oinum, inv.oidt,
        inv.inum, inv.idt,
        inv.val, posLabel(inv.pos),
        inv.rchrg, "",
        inv.inv_typ === "R" ? "Regular B2B" : inv.inv_typ,
        "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
      ]);
    }
  }
  writeRows("b2ba", b2baRows);

  // ── b2cl ──────────────────────────────────────────────────────
  const b2clRows: (string | number)[][] = [];
  for (const inv of g.b2cl) {
    for (const it of inv.itms) {
      b2clRows.push([
        inv.inum, inv.idt,
        inv.val, posLabel(inv.pos),
        "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, "",
      ]);
    }
  }
  writeRows("b2cl", b2clRows);

  // ── b2cla ─────────────────────────────────────────────────────
  // F3 (Invoice Value) is plain SUM → emit val only on first rate line.
  const b2claRows: (string | number)[][] = [];
  for (const inv of g.b2cla) {
    inv.itms.forEach((it, idx) => {
      const first = idx === 0;
      b2claRows.push([
        first ? inv.oinum : "", first ? inv.oidt : "", first ? posLabel(inv.pos) : "",
        first ? inv.inum : "", first ? inv.idt : "",
        first ? inv.val : "", "",
        it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, "",
      ]);
    });
  }
  writeRows("b2cla", b2claRows);

  // ── b2cs ──────────────────────────────────────────────────────
  const b2csRows: (string | number)[][] = [];
  for (const g2 of g.b2cs) b2csRows.push(["OE", posLabel(g2.pos), "", g2.rt, g2.txval, g2.csamt, ""]);
  writeRows("b2cs", b2csRows);

  // ── cdnr ──────────────────────────────────────────────────────
  // I3 (Note Value) is plain SUM → emit note header + val only on first rate line.
  const cdnrRows: (string | number)[][] = [];
  for (const n of g.cdnr) {
    n.itms.forEach((it, idx) => {
      const first = idx === 0;
      const supTy = it.itm_det.iamt > 0 ? "Inter State" : "Intra State";
      cdnrRows.push([
        first ? n.ctin : "", first ? n.recipient_name : "",
        first ? n.nt_num : "", first ? n.nt_dt : "",
        first ? n.ntty : "", first ? posLabel(n.pos) : "",
        first ? n.rchrg : "", supTy,
        first ? n.val : "", "",
        it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
      ]);
    });
  }
  writeRows("cdnr", cdnrRows);

  // ── cdnra ─────────────────────────────────────────────────────
  // K3 (Note Value) is plain SUM → emit note header + val only on first rate line.
  const cdnraRows: (string | number)[][] = [];
  for (const n of g.cdnra) {
    n.itms.forEach((it, idx) => {
      const first = idx === 0;
      const supTy = it.itm_det.iamt > 0 ? "Inter State" : "Intra State";
      cdnraRows.push([
        first ? n.ctin : "", first ? n.recipient_name : "",
        first ? n.ont_num : "", first ? n.ont_dt : "",
        first ? n.nt_num : "", first ? n.nt_dt : "",
        first ? n.ntty : "", first ? posLabel(n.pos) : "",
        first ? n.rchrg : "", supTy,
        first ? n.val : "", "",
        it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
      ]);
    });
  }
  writeRows("cdnra", cdnraRows);

  // ── cdnur ─────────────────────────────────────────────────────
  // F3 (Note Value) is plain SUM → emit note header + val only on first rate line.
  const cdnurRows: (string | number)[][] = [];
  for (const n of g.cdnur) {
    n.itms.forEach((it, idx) => {
      const first = idx === 0;
      cdnurRows.push([
        first ? n.typ : "", first ? n.nt_num : "", first ? n.nt_dt : "",
        first ? n.ntty : "", first ? posLabel(n.pos) : "",
        first ? n.val : "", "",
        it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
      ]);
    });
  }
  writeRows("cdnur", cdnurRows);


  // ── exp ───────────────────────────────────────────────────────
  const expRows: (string | number)[][] = [];
  for (const e of g.exp) {
    e.itms.forEach((it, idx) => {
      const first = idx === 0;
      expRows.push([
        first ? (e.exp_typ === "WPAY" ? "WPAY" : "WOPAY") : "",
        first ? e.inum : "", first ? e.idt : "", first ? e.val : "",
        first ? (e.sbpcode || "") : "", first ? (e.sbnum || "") : "", first ? (e.sbdt || "") : "",
        it.rt, it.txval, it.csamt,
      ]);
    });
  }
  writeRows("exp", expRows);


  // ── exemp (Nil rated / Exempted / Non-GST) ────────────────────
  const nilByTy = new Map<string, { nil: number; exp: number; ngs: number }>();
  for (const n of g.nil) {
    const cur = nilByTy.get(n.sply_ty) ?? { nil: 0, exp: 0, ngs: 0 };
    cur.nil += n.nil_amt; cur.exp += n.expt_amt; cur.ngs += n.ngsup_amt;
    nilByTy.set(n.sply_ty, cur);
  }
  const exempOrder: (keyof typeof NIL_DESC)[] = ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"];
  const exempRows: (string | number)[][] = exempOrder.map((k) => {
    const v = nilByTy.get(k) ?? { nil: 0, exp: 0, ngs: 0 };
    return [NIL_DESC[k], v.nil, v.exp, v.ngs];
  });
  writeRows("exemp", exempRows);

  // ── hsn ───────────────────────────────────────────────────────
  const hsnRows = (items: BuiltGstr1["hsn_b2b"]): (string | number)[][] => items.map((h) => [
    h.hsn_sc, h.desc, h.uqc, h.qty, h.val, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt,
  ]);
  writeRows("hsn(b2b)", hsnRows(g.hsn_b2b));
  writeRows("hsn(b2c)", hsnRows(g.hsn_b2c));

  // ── docs ──────────────────────────────────────────────────────
  const docsRows: (string | number)[][] = g.docs.map((d) => [
    d.doc_typ, d.from, d.to, d.totnum, d.cancel,
  ]);
  writeRows("docs", docsRows);

  const out = await writeTemplateInWorker(buf, sheets);
  await saveExport({
    subFolder,
    fileName,
    contents: out as ArrayBuffer,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
