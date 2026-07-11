// GSTR-1 export using the OFFICIAL GSTN Offline-Tool Excel template.
// The template ships as a CDN asset (see src/assets/gstr1_template.xlsx.asset.json)
// and every sheet — colours, drop-downs (data validations), summary formulas,
// column widths, freeze panes — is preserved exactly. We ONLY inject data rows
// starting at row 5 of each mapped sheet. Sheets we don't compute (amendments,
// advances, e-commerce operator) are left blank but still delivered so the
// workbook matches the GSTN template shape 1-for-1.

import type { BuiltGstr1 } from "@/lib/gst-returns";
import { saveExport } from "@/lib/desktop-save";
import templateAsset from "@/assets/gstr1_template.xlsx.asset.json";

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

// In-memory + IndexedDB cache so the 7 MB official template is downloaded
// ONCE per device. Subsequent GSTR-1 exports reuse the cached buffer and
// complete in ~1-2 seconds instead of re-downloading + re-parsing every time.
let TEMPLATE_MEM: ArrayBuffer | null = null;
const IDB_NAME = "gstr1-template-cache";
const IDB_STORE = "templates";
const IDB_KEY = "official-v1";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(): Promise<ArrayBuffer | null> {
  try {
    const db = await idbOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function idbPut(buf: ArrayBuffer): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(buf, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

function isValidXlsx(b: ArrayBuffer): boolean {
  if (b.byteLength < 10000) return false;
  const h = new Uint8Array(b, 0, 4);
  return h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
}

async function fetchTemplateBuffer(): Promise<ArrayBuffer> {
  if (TEMPLATE_MEM && isValidXlsx(TEMPLATE_MEM)) return TEMPLATE_MEM;
  const cached = await idbGet();
  if (cached && isValidXlsx(cached)) { TEMPLATE_MEM = cached; return cached; }

  const rel = templateAsset.url;
  const abs = `https://your-smart-accountant1.lovable.app${rel}`;
  const urls = [abs, rel];
  let lastErr: unknown = null;
  for (const u of urls) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const r = await fetch(u, { cache: "force-cache", signal: ctl.signal });
      if (r.ok) {
        const b = await r.arrayBuffer();
        if (isValidXlsx(b)) {
          TEMPLATE_MEM = b;
          void idbPut(b);
          return b;
        }
        lastErr = new Error(`Non-xlsx payload from ${u} (${b.byteLength} bytes)`);
      } else {
        lastErr = new Error(`HTTP ${r.status} for ${u}`);
      }
    } catch (e) {
      lastErr = e instanceof Error && e.name === "AbortError"
        ? new Error(`Timed out fetching ${u} (offline?)`)
        : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch GSTR-1 template: ${String(lastErr)}`);
}

export async function exportGstr1UsingOfficialTemplate(
  g: BuiltGstr1,
  fileName: string,
  subFolder = "Reports",
): Promise<void> {
  const [{ default: ExcelJS }, buf] = await Promise.all([
    import("exceljs"),
    fetchTemplateBuffer(),
  ]);


  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  // Yield to the browser between sheets so the "Preparing…" toast repaints
  // instead of the tab appearing frozen while ExcelJS chews through rows.
  const yieldToUI = () => new Promise<void>((res) => setTimeout(res, 0));

  const writeRows = async (sheetName: string, rows: (string | number)[][], startRow = 5) => {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return;
    rows.forEach((row, i) => {
      const r = ws.getRow(startRow + i);
      row.forEach((v, c) => { r.getCell(c + 1).value = v as never; });
      r.commit();
    });
    await yieldToUI();
  };

  // ── b2b,sez,de ────────────────────────────────────────────────
  const b2bRows: (string | number)[][] = [];
  for (const inv of g.b2b) for (const it of inv.itms) {
    b2bRows.push([
      inv.ctin, inv.recipient_name, inv.inum, inv.idt, inv.val, posLabel(inv.pos),
      inv.rchrg, "", inv.inv_typ === "R" ? "Regular B2B" : inv.inv_typ,
      "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
    ]);
  }
  await writeRows("b2b,sez,de", b2bRows);

  // ── b2ba ──────────────────────────────────────────────────────
  const b2baRows: (string | number)[][] = [];
  for (const inv of g.b2ba) for (const it of inv.itms) {
    b2baRows.push([
      inv.ctin, inv.recipient_name, inv.oinum, inv.oidt, inv.inum, inv.idt, inv.val,
      posLabel(inv.pos), inv.rchrg, "", inv.inv_typ === "R" ? "Regular B2B" : inv.inv_typ,
      "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
    ]);
  }
  await writeRows("b2ba", b2baRows);

  // ── b2cl ──────────────────────────────────────────────────────
  const b2clRows: (string | number)[][] = [];
  for (const inv of g.b2cl) for (const it of inv.itms) {
    b2clRows.push([inv.inum, inv.idt, inv.val, posLabel(inv.pos), "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, ""]);
  }
  await writeRows("b2cl", b2clRows);

  // ── b2cla ─────────────────────────────────────────────────────
  const b2claRows: (string | number)[][] = [];
  for (const inv of g.b2cla) for (const it of inv.itms) {
    b2claRows.push([inv.oinum, inv.oidt, posLabel(inv.pos), inv.inum, inv.idt, inv.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt, ""]);
  }
  await writeRows("b2cla", b2claRows);

  // ── b2cs ──────────────────────────────────────────────────────
  const b2csRows: (string | number)[][] = [];
  for (const g2 of g.b2cs) b2csRows.push(["OE", posLabel(g2.pos), "", g2.rt, g2.txval, g2.csamt, ""]);
  await writeRows("b2cs", b2csRows);

  // ── cdnr ──────────────────────────────────────────────────────
  const cdnrRows: (string | number)[][] = [];
  for (const n of g.cdnr) for (const it of n.itms) {
    const supTy = it.itm_det.iamt > 0 ? "Inter State" : "Intra State";
    cdnrRows.push([
      n.ctin, n.recipient_name, n.nt_num, n.nt_dt, n.ntty, posLabel(n.pos), n.rchrg, supTy,
      n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
    ]);
  }
  await writeRows("cdnr", cdnrRows);

  // ── cdnra ─────────────────────────────────────────────────────
  const cdnraRows: (string | number)[][] = [];
  for (const n of g.cdnra) for (const it of n.itms) {
    const supTy = it.itm_det.iamt > 0 ? "Inter State" : "Intra State";
    cdnraRows.push([
      n.ctin, n.recipient_name, n.ont_num, n.ont_dt, n.nt_num, n.nt_dt, n.ntty, posLabel(n.pos),
      n.rchrg, supTy, n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt,
    ]);
  }
  await writeRows("cdnra", cdnraRows);

  // ── cdnur ─────────────────────────────────────────────────────
  const cdnurRows: (string | number)[][] = [];
  for (const n of g.cdnur) for (const it of n.itms) {
    cdnurRows.push([n.typ, n.nt_num, n.nt_dt, n.ntty, posLabel(n.pos), n.val, "", it.itm_det.rt, it.itm_det.txval, it.itm_det.csamt]);
  }
  await writeRows("cdnur", cdnurRows);

  // ── exp ───────────────────────────────────────────────────────
  const expRows: (string | number)[][] = [];
  for (const e of g.exp) for (const it of e.itms) {
    expRows.push([
      e.exp_typ === "WPAY" ? "WPAY" : "WOPAY",
      e.inum, e.idt, e.val,
      e.sbpcode || "", e.sbnum || "", e.sbdt || "",
      it.rt, it.txval, it.csamt,
    ]);
  }
  await writeRows("exp", expRows);

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
  await writeRows("exemp", exempRows);

  // ── hsn ───────────────────────────────────────────────────────
  // Official GSTN Offline-Tool template has ONE `hsn` sheet (not separate
  // b2b/b2c). Merge both maps into a single HSN Summary — aggregate rows
  // that share the same (HSN + Rate + UQC) key so totals reconcile with
  // Books HSN report + the sheet's own SUM formulas.
  const hsnMerged = new Map<string, {
    hsn_sc: string; desc: string; uqc: string; qty: number; rt: number;
    txval: number; iamt: number; camt: number; samt: number; csamt: number; val: number;
  }>();
  const pushHsn = (h: typeof hsnMerged extends Map<string, infer V> ? V : never) => {
    const key = `${h.hsn_sc}|${h.rt}|${h.uqc}`;
    const cur = hsnMerged.get(key);
    if (!cur) { hsnMerged.set(key, { ...h }); return; }
    cur.qty += h.qty; cur.txval += h.txval; cur.iamt += h.iamt;
    cur.camt += h.camt; cur.samt += h.samt; cur.csamt += h.csamt; cur.val += h.val;
  };
  for (const h of g.hsn_b2b) pushHsn({ ...h });
  for (const h of g.hsn_b2c) pushHsn({ ...h });
  const hsnRows: (string | number)[][] = Array.from(hsnMerged.values()).map((h) => [
    h.hsn_sc, h.desc, h.uqc, h.qty, h.val, h.rt, h.txval, h.iamt, h.camt, h.samt, h.csamt,
  ]);
  await writeRows("hsn", hsnRows);

  // ── docs ──────────────────────────────────────────────────────
  const docsRows: (string | number)[][] = g.docs.map((d) => [
    d.doc_typ, d.from, d.to, d.totnum, d.cancel,
  ]);
  await writeRows("docs", docsRows);

  const out = await wb.xlsx.writeBuffer();
  await saveExport({
    subFolder,
    fileName,
    contents: out as ArrayBuffer,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
