import { unzipSync, zipSync } from "fflate";

type CellValue = string | number;
type SheetRows = Record<string, CellValue[][]>;

interface ExportRequest {
  template: ArrayBuffer;
  sheets: SheetRows;
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
    const output = zipSync(files, { level: 1 });
    self.postMessage({ ok: true, output }, [output.buffer as ArrayBuffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
