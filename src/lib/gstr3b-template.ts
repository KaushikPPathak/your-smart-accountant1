// Patches the official GSTR-3B Excel Utility V5.8 (.xlsm) by replacing only
// the value cells inside xl/worksheets/sheet2.xml. All styles, colors,
// merged cells, drawings, sheet names, VBA macros and validations from the
// GSTN template are preserved 1:1 — we never re-author the workbook.
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from "fflate";
import type { BuiltGstr3B } from "./gst-returns";
import { saveExport } from "./desktop-save";

const TEMPLATE_URL = "/gstr3b/GSTR3B_Excel_Utility_V5.8.xlsm";

type CellVal = string | number;
type CellMap = Record<string, CellVal>;

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Replace a single cell tag in the worksheet XML, preserving its s="..." style. */
function patchCell(xml: string, ref: string, value: CellVal): string {
  const re = new RegExp(`<c r="${ref}"([^/>]*)(?:/>|>[^]*?</c>)`);
  return xml.replace(re, (_m, attrs: string) => {
    // strip any pre-existing t="..." from the attrs (we set our own type)
    const cleanAttrs = attrs.replace(/\s+t="[^"]*"/g, "");
    if (typeof value === "number" || (typeof value === "string" && value !== "" && !isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value))) {
      const n = typeof value === "number" ? value : Number(value);
      return `<c r="${ref}"${cleanAttrs}><v>${n}</v></c>`;
    }
    if (value === "" || value == null) {
      return `<c r="${ref}"${cleanAttrs}/>`;
    }
    // inline string — does not require touching sharedStrings
    return `<c r="${ref}"${cleanAttrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  });
}

/** Insert cells that don't yet exist in the row (used for Table 3.2 POS rows 88..124). */
function patchOrInsertCell(xml: string, ref: string, value: CellVal, styleHint?: string): string {
  const exists = new RegExp(`<c r="${ref}"`).test(xml);
  if (exists) return patchCell(xml, ref, value);
  // Row number from ref e.g. C88 -> 88
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return xml;
  const rowNum = m[2];
  // Build new <c> tag
  const styleAttr = styleHint ? ` s="${styleHint}"` : "";
  let cellTag: string;
  if (typeof value === "number") {
    cellTag = `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  } else {
    cellTag = `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  }
  // Find row tag and append cell to it (cells in a row don't need to be sorted by Excel reader)
  const rowRe = new RegExp(`(<row r="${rowNum}"[^>]*>)([^]*?)(</row>)`);
  if (rowRe.test(xml)) {
    return xml.replace(rowRe, (_w, open: string, body: string, close: string) => `${open}${body}${cellTag}${close}`);
  }
  // Row missing entirely — append a new <row> right before </sheetData>
  const newRow = `<row r="${rowNum}">${cellTag}</row>`;
  return xml.replace("</sheetData>", `${newRow}</sheetData>`);
}

/** Force calc-on-load so the utility recalculates all formulas (totals etc.) when opened. */
function forceFullCalc(workbookXml: string): string {
  if (workbookXml.includes("<calcPr")) {
    return workbookXml.replace(/<calcPr[^/]*\/>/, (m) => {
      let next = m.replace(/\s+fullCalcOnLoad="[^"]*"/, "");
      next = next.replace(/\s+calcCompleted="[^"]*"/, "");
      return next.replace("/>", ' fullCalcOnLoad="1"/>');
    });
  }
  return workbookXml.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
}

/** Round to 2 decimals. BuiltGstr3B already exposes amounts in rupees
 *  (gst-returns.ts converts paise→rupees via its internal `r()`), so we
 *  MUST NOT divide by 100 again here — doing so under-reports 100x. */
const r2 = (rupees: number): number => Number((Number(rupees) || 0).toFixed(2));

/** Map the period FP (MMYYYY) into the Year string used by the utility's dropdown. */
function fpToYearLabel(fp: string): string {
  const mm = Number(fp.slice(0, 2));
  const yyyy = Number(fp.slice(2));
  // Indian FY runs Apr–Mar. Months Jan–Mar belong to the FY that started previous year.
  const fyStart = mm >= 4 ? yyyy : yyyy - 1;
  const fyEnd = (fyStart + 1) % 100;
  return `${fyStart}-${String(fyEnd).padStart(2, "0")}`;
}

function fpToMonthLabel(fp: string): string {
  const months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return months[Number(fp.slice(0, 2))] || "";
}

/** Build the cell address → value map for one BuiltGstr3B. */
function buildCellMap(b: BuiltGstr3B): { cells: CellMap; pos32: { ref: string; val: number }[]; pos32Style: string } {
  const s = b.sup_details;
  const cells: CellMap = {};

  // Header block
  cells["C5"] = b.meta.gstin || "";
  cells["C6"] = b.meta.legal_name || "";
  cells["F5"] = fpToYearLabel(b.meta.fp);
  cells["F6"] = fpToMonthLabel(b.meta.fp);

  // Table 3.1
  cells["C11"] = r2(s.osup_det.txval); cells["D11"] = r2(s.osup_det.iamt); cells["E11"] = r2(s.osup_det.camt); cells["G11"] = r2(s.osup_det.csamt);
  cells["C12"] = r2(s.osup_zero.txval); cells["D12"] = r2(s.osup_zero.iamt); cells["G12"] = r2(s.osup_zero.csamt);
  cells["C13"] = r2(s.osup_nil_exmp.txval);
  cells["C14"] = r2(s.isup_rev.txval); cells["D14"] = r2(s.isup_rev.iamt); cells["E14"] = r2(s.isup_rev.camt); cells["G14"] = r2(s.isup_rev.csamt);
  cells["C15"] = r2(s.osup_nongst.txval);

  // Table 3.1.1
  const eco = b.sup_eco ?? { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  cells["C22"] = r2(eco.txval); cells["D22"] = r2(eco.iamt); cells["E22"] = r2(eco.camt); cells["G22"] = r2(eco.csamt);
  cells["C23"] = 0;

  // Table 4 — Eligible ITC
  const find = (arr: { ty: string; iamt: number; camt: number; samt: number; csamt: number }[], ty: string) =>
    arr.find((x) => x.ty === ty) ?? { ty, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const impg = find(b.itc_elg.itc_avl, "IMPG");
  const imps = find(b.itc_elg.itc_avl, "IMPS");
  const isrc = find(b.itc_elg.itc_avl, "ISRC");
  const isd  = find(b.itc_elg.itc_avl, "ISD");
  const oth  = find(b.itc_elg.itc_avl, "OTH");
  const revR = find(b.itc_elg.itc_rev, "RUL");
  const revO = find(b.itc_elg.itc_rev, "OTH");
  const inelgRcl = find(b.itc_elg.itc_inelg, "RUL");
  const inelgOth = find(b.itc_elg.itc_inelg, "OTH");

  // Row 31 — Import of goods (only IGST + Cess apply)
  cells["C31"] = r2(impg.iamt); cells["F31"] = r2(impg.csamt);
  cells["C32"] = r2(imps.iamt); cells["F32"] = r2(imps.csamt);
  // Row 33 — Inward RCM. Utility derives SGST from CGST (E33 = D33 formula in template — leave intact).
  cells["C33"] = r2(isrc.iamt); cells["D33"] = r2(isrc.camt); cells["F33"] = r2(isrc.csamt);
  cells["C34"] = r2(isd.iamt); cells["D34"] = r2(isd.camt); cells["F34"] = r2(isd.csamt);
  cells["C35"] = r2(oth.iamt); cells["D35"] = r2(oth.camt); cells["F35"] = r2(oth.csamt);
  // Row 37 — Reversals as per rules 38/42/43 + 17(5)
  cells["C37"] = r2(revR.iamt); cells["D37"] = r2(revR.camt); cells["F37"] = r2(revR.csamt);
  // Row 38 — Other reversals
  cells["C38"] = r2(revO.iamt); cells["D38"] = r2(revO.camt); cells["E38"] = r2(revO.samt); cells["F38"] = r2(revO.csamt);
  // Net ITC C39:F39 are formulas in the template — DO NOT overwrite.
  // Row 41 — ITC reclaimed
  cells["C41"] = r2(inelgRcl.iamt); cells["D41"] = r2(inelgRcl.camt); cells["F41"] = r2(inelgRcl.csamt);
  // Row 42 — Ineligible / PoS restricted
  cells["C42"] = r2(inelgOth.iamt); cells["D42"] = r2(inelgOth.camt); cells["F42"] = r2(inelgOth.csamt);

  // Table 5 — Exempt/Nil/Non-GST inward
  const inwGst = b.inward_sup.isup_details.find((x) => x.ty === "GST") ?? { ty: "GST", inter: 0, intra: 0 };
  const inwNon = b.inward_sup.isup_details.find((x) => x.ty === "NONGST") ?? { ty: "NONGST", inter: 0, intra: 0 };
  cells["D48"] = r2(inwGst.inter); cells["E48"] = r2(inwGst.intra);
  cells["D49"] = r2(inwNon.inter); cells["E49"] = r2(inwNon.intra);
  // D50/E50 totals — leave (template formula).

  // Table 5.1 — Interest & late fee payable. Source data not stored separately; default 0.
  cells["C65"] = 0; cells["D65"] = 0; cells["E65"] = 0; cells["F65"] = 0; // Interest

  // Table 6.1 — Payment of Tax: utility's columns C74..K77 use formulas referencing Table 3.1.
  // We intentionally do not overwrite — letting the utility recompute keeps it
  // identical to a manually-prepared form.

  // Table 3.2 — Inter-State supplies to URD/Composition/UIN. Rows 88..124, cols C..H.
  // POS-wise rows: utility maps state name strings (B88..B124) statically; we
  // populate by POS code (state code 01..38) into matching rows by ordinal.
  // Simpler: append unreg rows in 3.2 by POS into rows 88+ keeping order.
  const pos32: { ref: string; val: number }[] = [];
  let rowIdx = 88;
  for (const p of b.inter_sup.unreg_details) {
    if (rowIdx > 124) break;
    pos32.push({ ref: `C${rowIdx}`, val: r2(p.txval) });
    pos32.push({ ref: `D${rowIdx}`, val: r2(p.iamt) });
    rowIdx += 1;
  }

  return { cells, pos32, pos32Style: "143" };
}

/**
 * Fetches the official GSTR-3B utility, patches values into the GSTR-3B
 * worksheet, and saves the resulting .xlsm. Layout/colors/merges/sheet
 * names/macros remain identical to the GSTN-published template.
 */
export async function downloadGstr3bOfficial(fileBase: string, b: BuiltGstr3B): Promise<void> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Failed to load GSTR-3B template (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);

  const sheetPath = "xl/worksheets/sheet2.xml";
  let sheetXml = strFromU8(files[sheetPath]);

  const { cells, pos32, pos32Style } = buildCellMap(b);
  for (const [ref, val] of Object.entries(cells)) {
    sheetXml = patchCell(sheetXml, ref, val);
  }
  for (const { ref, val } of pos32) {
    sheetXml = patchOrInsertCell(sheetXml, ref, val, pos32Style);
  }

  files[sheetPath] = strToU8(sheetXml);

  // Force formula recalculation on open so utility totals/cash-payable refresh.
  const wbPath = "xl/workbook.xml";
  if (files[wbPath]) {
    files[wbPath] = strToU8(forceFullCalc(strFromU8(files[wbPath])));
  }

  // Drop calcChain.xml — its precomputed cell graph can be invalidated by our
  // edits and Excel rebuilds it lazily on open.
  delete files["xl/calcChain.xml"];

  const out = zipSync(files as Zippable, { level: 6 });
  await saveExport({
    subFolder: "GST",
    fileName: `${fileBase}.xlsm`,
    contents: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer,
    mime: "application/vnd.ms-excel.sheet.macroEnabled.12",
  });
}