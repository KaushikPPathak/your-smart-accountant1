// Spreadsheet read/write on top of ExcelJS.
//
// Writers take the same cell shapes the report code already builds
// ({ t, v, z } objects, plain strings/numbers/Dates) and produce an .xlsx
// ArrayBuffer. Readers load a workbook once (async) and return dense row
// matrices, so the import parsers can stay synchronous after the load.
//
// Known differences from the previous SheetJS implementation are noted in
// the comments below (empty cells, error values, sheet-name checks).
import ExcelJS from "exceljs";
import { dateToExcelSerial } from "./excel-serial";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SheetCellObject {
  /** n = number, s = string, d = date, b = boolean. Inferred from `v` when omitted. */
  t?: "n" | "s" | "d" | "b";
  v?: unknown;
  /** Excel number format string. */
  z?: string;
}

export type SheetCell = string | number | boolean | Date | SheetCellObject | null | undefined;

export interface WriteSheet {
  name: string;
  rows: SheetCell[][];
  /** 0-based header row for the auto-filter. Defaults to 0; null disables it. */
  autoFilterHeaderRow?: number | null;
  /** "gstn" applies the GST offline-tool look (only when `styled` is true). */
  styling?: "gstn";
}

export interface CellAddress { r: number; c: number }
export interface CellRange { s: CellAddress; e: CellAddress }

export interface SpreadsheetSheet {
  name: string;
  /** Dense 0-based matrix. `undefined` marks an empty cell. */
  rows: unknown[][];
  /** Merged ranges, 0-based. */
  merges: CellRange[];
}

export interface SpreadsheetBook {
  SheetNames: string[];
  Sheets: Record<string, SpreadsheetSheet>;
}

export interface ReadOptions {
  /** true: date-formatted cells come back as Date. false: as Excel serial numbers. */
  cellDates?: boolean;
}

export interface WriteOptions {
  /** Apply "gstn" header styling to sheets that request it. */
  styled?: boolean;
  onProgress?: (rowsDone: number, stage: string) => void;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const MAX_DATA_ROWS_PER_SHEET = 500_000; // Excel supports 1,048,576; split earlier for responsiveness.
const CHUNK_ROWS = 2000;
const DEFAULT_DATE_FMT = "m/d/yy";
const MAX_SHEET_NAME = 31;

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF305496" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
const TITLE_FONT = { bold: true, size: 14, color: { argb: "FF000000" }, name: "Calibri" };
const SUB_FONT = { bold: true, size: 11, color: { argb: "FF000000" }, name: "Calibri" };
const BORDER_THIN = { style: "thin" as const, color: { argb: "FF9BB6D8" } };

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const view = data as ArrayBufferView;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Load an .xlsx workbook. Async because ExcelJS parses the zip asynchronously. */
export async function readSpreadsheet(
  data: ArrayBuffer | Uint8Array,
  opts: ReadOptions = {},
): Promise<SpreadsheetBook> {
  const cellDates = opts.cellDates ?? false;
  const buffer = toArrayBuffer(data);
  // Legacy Excel 97-2003 files (.xls) start with the OLE2 signature D0 CF 11 E0.
  // ExcelJS reads only .xlsx, so say what to do instead of failing obscurely.
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (head.length === 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new Error(
      "This is an old Excel (.xls) file. In Excel, use File > Save As and choose Excel Workbook (.xlsx), then upload it again.",
    );
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as Parameters<typeof wb.xlsx.load>[0]);

  const SheetNames: string[] = [];
  const Sheets: Record<string, SpreadsheetSheet> = {};
  for (const ws of wb.worksheets) {
    const sheet = readWorksheet(ws, cellDates);
    SheetNames.push(sheet.name);
    Sheets[sheet.name] = sheet;
  }
  return { SheetNames, Sheets };
}

/**
 * Row matrix for a sheet. Equivalent of the old
 * `XLSX.utils.sheet_to_json(sheet, { header: 1, defval, blankrows, range })`.
 * - defval: value used for empty cells (default undefined)
 * - blankrows: false drops rows whose cells are all empty (default true)
 * - range: number of leading rows to skip
 */
export function sheetRows(
  sheet: SpreadsheetSheet,
  opts: { defval?: unknown; blankrows?: boolean; range?: number } = {},
): unknown[][] {
  const { defval, blankrows = true, range = 0 } = opts;
  const out: unknown[][] = [];
  for (let i = range; i < sheet.rows.length; i++) {
    const src = sheet.rows[i];
    if (!blankrows && src.every((c) => c === undefined || c === null)) continue;
    out.push(src.map((c) => (c === undefined ? defval : c)));
  }
  return out;
}

function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRangeRef(ref: string): CellRange | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return {
    s: { r: Number(m[2]) - 1, c: colToNumber(m[1]) - 1 },
    e: { r: Number(m[4]) - 1, c: colToNumber(m[3]) - 1 },
  };
}

function readWorksheet(ws: ExcelJS.Worksheet, cellDates: boolean): SpreadsheetSheet {
  const nRows = ws.rowCount;
  const nCols = ws.columnCount;
  const rows: unknown[][] = Array.from({ length: nRows }, () => new Array<unknown>(nCols).fill(undefined));

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      rows[rowNumber - 1][colNumber - 1] = convertCellValue(cell.value, cellDates);
    });
  });

  const merges: CellRange[] = [];
  const rawMerges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
  for (const ref of rawMerges) {
    const range = parseRangeRef(ref);
    if (range) merges.push(range);
  }
  // ExcelJS reports a merged slave cell as showing the master's value; SheetJS
  // only keeps the value in the top-left cell. Blank the slaves to match.
  for (const { s, e } of merges) {
    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        if (r === s.r && c === s.c) continue;
        if (rows[r] && c < rows[r].length) rows[r][c] = undefined;
      }
    }
  }

  return { name: ws.name, rows, merges };
}

function convertCellValue(value: unknown, cellDates: boolean): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return cellDates ? value : dateToExcelSerial(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
    }
    if ("formula" in obj || "sharedFormula" in obj) {
      // Cached result, as SheetJS raw reads expose it. Formulas without a cached value are empty.
      return obj.result === undefined ? undefined : convertCellValue(obj.result, cellDates);
    }
    if ("hyperlink" in obj) {
      return obj.text === undefined ? undefined : convertCellValue(obj.text, cellDates);
    }
    if ("error" in obj) return String(obj.error);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Split very long sheets, as the export worker always did (<Name>, <Name> (2), ...). */
function expandForRollover(sheets: WriteSheet[]): WriteSheet[] {
  const out: WriteSheet[] = [];
  for (const s of sheets) {
    const headerRowIdx = s.autoFilterHeaderRow ?? 0;
    const headerRows = s.rows.slice(0, headerRowIdx + 1);
    const dataRows = s.rows.slice(headerRowIdx + 1);
    if (dataRows.length <= MAX_DATA_ROWS_PER_SHEET) {
      out.push(s);
      continue;
    }
    const parts = Math.ceil(dataRows.length / MAX_DATA_ROWS_PER_SHEET);
    for (let p = 0; p < parts; p++) {
      const slice = dataRows.slice(p * MAX_DATA_ROWS_PER_SHEET, (p + 1) * MAX_DATA_ROWS_PER_SHEET);
      out.push({
        ...s,
        name: p === 0 ? s.name : `${s.name} (${p + 1})`.slice(0, MAX_SHEET_NAME),
        rows: [...headerRows, ...slice],
      });
    }
  }
  return out;
}

interface MappedCell { value: ExcelJS.CellValue; numFmt?: string }

function mapCell(cell: SheetCell): MappedCell | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "string" || typeof cell === "boolean") return { value: cell };
  if (typeof cell === "number") return Number.isFinite(cell) ? { value: cell } : null;
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? null : { value: cell, numFmt: DEFAULT_DATE_FMT };
  }
  const obj = cell as SheetCellObject;
  const raw = obj.v;
  if (raw === null || raw === undefined) return null;
  switch (obj.t) {
    case "d": {
      const d = raw instanceof Date ? raw : new Date(raw as string | number);
      return Number.isNaN(d.getTime()) ? null : { value: d, numFmt: obj.z ?? DEFAULT_DATE_FMT };
    }
    case "n": {
      const n = Number(raw);
      return Number.isFinite(n) ? { value: n, numFmt: obj.z } : null;
    }
    case "b":
      return { value: Boolean(raw) };
    case "s":
      return { value: String(raw) };
    default:
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : { value: raw, numFmt: obj.z ?? DEFAULT_DATE_FMT };
      }
      if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw, numFmt: obj.z } : null;
      if (typeof raw === "boolean") return { value: raw };
      return { value: String(raw) };
  }
}

function applyGstnStyling(ws: ExcelJS.Worksheet, headerRowIdx: number, width: number): void {
  const CENTER = { horizontal: "center" as const, vertical: "middle" as const, wrapText: true };
  const CELL_BORDER = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
  const hasValue = (r: number, c: number): boolean => {
    const v = ws.getCell(r, c).value;
    return v !== null && v !== undefined;
  };

  for (let c = 0; c < width; c++) {
    if (!hasValue(headerRowIdx + 1, c + 1)) continue;
    ws.getCell(headerRowIdx + 1, c + 1).style = {
      fill: HEADER_FILL,
      font: HEADER_FONT,
      alignment: CENTER,
      border: CELL_BORDER,
    };
  }

  if (headerRowIdx >= 1) {
    if (hasValue(1, 1)) {
      ws.getCell(1, 1).style = { font: TITLE_FONT, alignment: { horizontal: "left" } };
    }
    if (width > 1) ws.mergeCells(1, 1, 1, width);
  }

  if (headerRowIdx >= 2) {
    for (let c = 0; c < 2; c++) {
      if (hasValue(2, c + 1)) ws.getCell(2, c + 1).style = { font: SUB_FONT };
    }
  }

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: headerRowIdx + 1 }];
  ws.getRow(1).height = 22;
  ws.getRow(headerRowIdx + 1).height = 30;
}

/** Build an .xlsx file. Resolves to the file bytes as an ArrayBuffer. */
export async function writeSpreadsheet(sheets: WriteSheet[], opts: WriteOptions = {}): Promise<ArrayBuffer> {
  const styled = opts.styled === true;
  const progress = opts.onProgress ?? (() => {});
  const working = expandForRollover(sheets);

  const wb = new ExcelJS.Workbook();
  let rowsDone = 0;
  progress(rowsDone, "preparing");

  for (const s of working) {
    const name = s.name.slice(0, MAX_SHEET_NAME);
    if (wb.getWorksheet(name)) throw new Error(`Worksheet with name ${name} already exists`);
    const ws = wb.addWorksheet(name);

    // Write in chunks so large ledgers can yield to the event loop and report progress.
    for (let i = 0; i < s.rows.length; i += CHUNK_ROWS) {
      const slice = s.rows.slice(i, i + CHUNK_ROWS);
      slice.forEach((row, k) => {
        const excelRow = ws.getRow(i + k + 1);
        row.forEach((cell, c) => {
          const mapped = mapCell(cell);
          if (!mapped) return;
          const target = excelRow.getCell(c + 1);
          target.value = mapped.value;
          if (mapped.numFmt) target.numFmt = mapped.numFmt;
        });
      });
      rowsDone += slice.length;
      progress(rowsDone, `sheet:${name}`);
      await yieldToEventLoop();
    }

    const headerRowIdx = s.autoFilterHeaderRow ?? 0;
    const header = s.rows[headerRowIdx] ?? s.rows[0] ?? [];

    header.forEach((cell, c) => {
      const text = typeof cell === "string" ? cell : (cell as SheetCellObject | null)?.v ?? "";
      const len = String(text).length;
      ws.getColumn(c + 1).width = Math.max(10, Math.min(40, len + 4));
    });

    if (s.autoFilterHeaderRow !== null && header.length > 0) {
      const lastCol = header.length - 1;
      const lastRow = Math.max(headerRowIdx, s.rows.length - 1);
      ws.autoFilter = {
        from: { row: headerRowIdx + 1, column: 1 },
        to: { row: lastRow + 1, column: lastCol + 1 },
      };
    }

    if (styled && s.styling === "gstn" && header.length > 0) {
      applyGstnStyling(ws, headerRowIdx, header.length);
    }
  }

  progress(rowsDone, "writing");
  const out = await wb.xlsx.writeBuffer();
  return toArrayBuffer(out as unknown as ArrayBuffer | ArrayBufferView);
}
