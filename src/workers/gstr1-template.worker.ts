import { unzipSync, zipSync } from "fflate";

type CellValue = string | number;
type SheetRows = Record<string, CellValue[][]>;
type DedupTotalConfig = { valCol: string; total: number };
type DedupTotals = Record<string, DedupTotalConfig>;

interface ExportRequest {
  template: ArrayBuffer;
  sheets: SheetRows;
  dedupTotals?: DedupTotals;
}


const decoder = new TextDecoder();
const encoder = new TextEncoder();

const xmlEscape = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function columnName(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  }
  return result;
}

function sheetTargets(files: Record<string, Uint8Array>): Map<string, string> {
  const workbook = decoder.decode(files["xl/workbook.xml"]);
  const relationships = decoder.decode(files["xl/_rels/workbook.xml.rels"]);
  const relTargets = new Map<string, string>();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/g)) {
    const target = match[2].replace(/^\//, "");
    relTargets.set(match[1], target.startsWith("xl/") ? target : `xl/${target}`);
  }
  const result = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)) {
    const target = relTargets.get(match[2]);
    if (target) result.set(match[1], target);
  }
  return result;
}

function replaceSheetData(xml: string, rows: CellValue[][]): string {
  const sheetData = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetData) throw new Error("Invalid GST workbook sheet");

  const headerRows = Array.from(sheetData[1].matchAll(/<row\b[^>]*\br="([1-4])"[^>]*>[\s\S]*?<\/row>/g), (m) => m[0]);
  const sampleRow = sheetData[1].match(/<row\b[^>]*\br="(?:5|6|7|8)"[^>]*>[\s\S]*?<\/row>/)?.[0] ?? "";
  const styles = new Map<number, string>();
  for (const match of sampleRow.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*\bs="([^"]+)"[^>]*>/g)) {
    let index = 0;
    for (const char of match[1]) index = index * 26 + char.charCodeAt(0) - 64;
    styles.set(index - 1, match[2]);
  }

  const dataRows = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 5;
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${excelRow}`;
      const style = styles.has(colIndex) ? ` s="${styles.get(colIndex)}"` : "";
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"${style}><v>${value}</v></c>`;
      }
      const text = xmlEscape(String(value ?? ""));
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join("");
    return `<row r="${excelRow}">${cells}</row>`;
  }).join("");

  const lastRow = Math.max(4, rows.length + 4);
  const lastCol = columnName(Math.max(0, ...rows.map((row) => row.length - 1)));
  const body = `<sheetData>${headerRows.join("")}${dataRows}</sheetData>`;
  return xml
    .replace(sheetData[0], body)
    .replace(/<dimension\b[^>]*\bref="[^"]+"[^>]*\/>/, `<dimension ref="A1:${lastCol}${lastRow}"/>`);
}

self.onmessage = (event: MessageEvent<ExportRequest>) => {
  try {
    const files = unzipSync(new Uint8Array(event.data.template));
    const targets = sheetTargets(files);
    for (const [name, rows] of Object.entries(event.data.sheets)) {
      const path = targets.get(name);
      if (!path || !files[path]) throw new Error(`Official sheet not found: ${name}`);
      files[path] = encoder.encode(replaceSheetData(decoder.decode(files[path]), rows));
    }
    // Rewrite row-3 "Total Invoice/Note Value" cells for sheets that split
    // one invoice into multiple GST-rate rows. We repeat the invoice value
    // on every rate row (so users don't hand-fill blanks and double-count),
    // and replace the template's plain SUM formula with a dedup formula that
    // divides each row's value by how many rate rows share its invoice number
    // — so the total counts each invoice exactly once.
    const dedupTotals = event.data.dedupTotals ?? {};
    for (const [sheetName, cfg] of Object.entries(dedupTotals)) {
      const path = targets.get(sheetName);
      if (!path || !files[path]) continue;
      const rows = event.data.sheets[sheetName] ?? [];
      if (rows.length === 0) continue;
      const last = rows.length + 4;
      const valRange = `${cfg.valCol}5:${cfg.valCol}${last}`;
      const invRange = `${cfg.invCol}5:${cfg.invCol}${last}`;
      // IFERROR guards against blank invoice-number cells (COUNTIF→0 → div/0).
      const formula = `SUMPRODUCT(IFERROR(${valRange}/COUNTIF(${invRange},${invRange}),0))`;
      const cellRef = `${cfg.valCol}3`;
      let xml = decoder.decode(files[path]);
      const cellRe = new RegExp(`<c\\s+r="${cellRef}"[^>]*>[\\s\\S]*?<\\/c>`);
      const match = xml.match(cellRe);
      if (!match) continue;
      const styleAttr = match[0].match(/\ss="[^"]+"/)?.[0] ?? "";
      const newCell = `<c r="${cellRef}"${styleAttr}><f>${formula}</f></c>`;
      xml = xml.replace(cellRe, newCell);
      files[path] = encoder.encode(xml);
    }
    // Force Excel to recompute the row-3 SUM/SUMPRODUCT totals on open; otherwise
    // the template's cached <v>0</v> values show as 0.00 until the user hits F9.

    const wbPath = "xl/workbook.xml";
    if (files[wbPath]) {
      let wb = decoder.decode(files[wbPath]);
      if (/<calcPr\b[^/]*\/>/.test(wb)) {
        wb = wb.replace(/<calcPr\b([^/]*)\/>/, (_m, attrs) => {
          const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "").replace(/\s*forceFullCalc="[^"]*"/, "");
          return `<calcPr${cleaned} fullCalcOnLoad="1" forceFullCalc="1"/>`;
        });
      } else {
        wb = wb.replace("</workbook>", `<calcPr fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
      }
      files[wbPath] = encoder.encode(wb);
    }
    const output = zipSync(files, { level: 1 });
    self.postMessage({ ok: true, output }, [output.buffer as ArrayBuffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
