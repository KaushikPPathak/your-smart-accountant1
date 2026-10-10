/**
 * GSTR-9 Books-side Purchase Register import.
 *
 * This is a reconciliation/working-paper source only. It never creates,
 * updates, or deletes accounting vouchers.
 */
import * as XLSX from "xlsx";

export interface Gstr9PurchaseRegisterLine {
  id: string;
  supplierName: string;
  supplierGstin: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalValue: number;
}

export interface Gstr9PurchaseRegisterImport {
  source: "EXCEL" | "JSON";
  fileName: string;
  importedAt: string;
  lines: Gstr9PurchaseRegisterLine[];
  totals: {
    taxableValue: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    totalValue: number;
  };
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function header(value: unknown): string {
  return text(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/,/g, "").replace(/₹/g, "").trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  const parsed = Number(raw.replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
}

function dateValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const raw = text(value);
  if (!raw) return null;
  const direct = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (direct) return `${direct[1]}-${String(Number(direct[2])).padStart(2, "0")}-${String(Number(direct[3])).padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return raw;
}

function findColumn(columns: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const target = header(alias);
    const exact = columns.findIndex((column) => column === target);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const target = header(alias);
    const partial = columns.findIndex((column) => column.includes(target) || target.includes(column));
    if (partial >= 0) return partial;
  }
  return -1;
}

function parseRows(rows: unknown[][]): Gstr9PurchaseRegisterLine[] {
  const usable = rows.filter((row) => Array.isArray(row) && row.some((cell) => text(cell)));
  if (!usable.length) return [];

  let headerIndex = 0;
  let columns = usable[0].map(header);
  const candidate = usable.findIndex((row) => {
    const cols = row.map(header);
    return findColumn(cols, ["Invoice No", "Invoice Number", "Vendor Invoice No", "Bill No"]) >= 0 &&
      findColumn(cols, ["Taxable Value", "Taxable Amount", "Taxable"]) >= 0;
  });
  if (candidate >= 0) {
    headerIndex = candidate;
    columns = usable[candidate].map(header);
  }

  const idx = {
    supplierName: findColumn(columns, ["Supplier Name", "Vendor Name", "Party Name", "Supplier"]),
    supplierGstin: findColumn(columns, ["Supplier GSTIN", "Vendor GSTIN", "GSTIN", "GSTIN/UIN"]),
    invoiceNo: findColumn(columns, ["Invoice No", "Invoice Number", "Vendor Invoice No", "Bill No", "Document No"]),
    invoiceDate: findColumn(columns, ["Invoice Date", "Bill Date", "Document Date"]),
    taxableValue: findColumn(columns, ["Taxable Value", "Taxable Amount", "Taxable"]),
    igst: findColumn(columns, ["IGST", "IGST Amount"]),
    cgst: findColumn(columns, ["CGST", "CGST Amount"]),
    sgst: findColumn(columns, ["SGST", "SGST Amount", "SGST/UTGST", "UTGST"]),
    cess: findColumn(columns, ["Cess", "Cess Amount"]),
    totalValue: findColumn(columns, ["Invoice Value", "Total Value", "Invoice Amount", "Total Amount", "Gross Value"]),
  };

  if (idx.invoiceNo < 0 || idx.taxableValue < 0) {
    throw new Error("Purchase Register must contain Invoice No and Taxable Value columns.");
  }

  const lines: Gstr9PurchaseRegisterLine[] = [];
  for (let r = headerIndex + 1; r < usable.length; r += 1) {
    const row = usable[r];
    const invoiceNo = text(row[idx.invoiceNo]);
    const taxableValue = numberValue(row[idx.taxableValue]);
    if (!invoiceNo && taxableValue === 0) continue;
    const igst = idx.igst >= 0 ? numberValue(row[idx.igst]) : 0;
    const cgst = idx.cgst >= 0 ? numberValue(row[idx.cgst]) : 0;
    const sgst = idx.sgst >= 0 ? numberValue(row[idx.sgst]) : 0;
    const cess = idx.cess >= 0 ? numberValue(row[idx.cess]) : 0;
    const totalValue = idx.totalValue >= 0 ? numberValue(row[idx.totalValue]) : taxableValue + igst + cgst + sgst + cess;
    lines.push({
      id: `pr_${r}_${invoiceNo}`,
      supplierName: idx.supplierName >= 0 ? text(row[idx.supplierName]) : "",
      supplierGstin: idx.supplierGstin >= 0 ? text(row[idx.supplierGstin]) || null : null,
      invoiceNo,
      invoiceDate: idx.invoiceDate >= 0 ? dateValue(row[idx.invoiceDate]) : null,
      taxableValue,
      igst,
      cgst,
      sgst,
      cess,
      totalValue,
    });
  }

  return lines;
}

function makeImport(source: "EXCEL" | "JSON", fileName: string, lines: Gstr9PurchaseRegisterLine[]): Gstr9PurchaseRegisterImport {
  const totals = lines.reduce((acc, line) => {
    acc.taxableValue += line.taxableValue;
    acc.igst += line.igst;
    acc.cgst += line.cgst;
    acc.sgst += line.sgst;
    acc.cess += line.cess;
    acc.totalValue += line.totalValue;
    return acc;
  }, { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, totalValue: 0 });
  return { source, fileName, importedAt: new Date().toISOString(), lines, totals };
}

export function parseGstr9PurchaseRegisterJson(textValue: string, fileName = "purchase-register.json"): Gstr9PurchaseRegisterImport {
  const parsed = JSON.parse(textValue) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).rows ?? (parsed as Record<string, unknown>).data ?? (parsed as Record<string, unknown>).purchases ?? (parsed as Record<string, unknown>).purchaseRegister ?? [])
        : []);
  if (!Array.isArray(rows)) throw new Error("Purchase Register JSON must contain an array of rows.");
  const objects = rows as Array<Record<string, unknown>>;
  if (objects.length && !Array.isArray(objects[0])) {
    const keys = Object.keys(objects[0]);
    const matrix = [keys, ...objects.map((row) => keys.map((key) => row[key]))];
    return makeImport("JSON", fileName, parseRows(matrix));
  }
  return makeImport("JSON", fileName, parseRows(rows as unknown[][]));
}

export function parseGstr9PurchaseRegisterExcel(buffer: ArrayBuffer, fileName = "purchase-register.xlsx"): Gstr9PurchaseRegisterImport {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    try {
      const lines = parseRows(rows);
      if (lines.length) return makeImport("EXCEL", fileName, lines);
    } catch {
      // Try the next sheet; many purchase registers contain a cover/summary sheet.
    }
  }
  throw new Error("No usable Purchase Register sheet found. Required columns include Invoice No and Taxable Value.");
}
