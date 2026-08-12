// Shared export formatting helpers — keeps PDF/XLSX templates aligned with the
// company's global currency symbol and date format. Excel cells are emitted
// as real numbers/dates (with numFmt) so SUM/pivot work in the exported file.
import * as XLSX from "xlsx";
import { getCurrentCurrencySymbol, getCurrentCurrencyCode } from "./currency";
import { getCurrentDateFormat, type DateFormatCode } from "./date-format";
import { parseAppDate } from "./format-date";

/** Symbol for the active currency (e.g. "₹", "$"). */
export function exportCurrencySymbol(): string {
  return getCurrentCurrencySymbol();
}

/** "Amount" → "Amount (₹)" / "Amount ($)". Use in PDF/XLSX column headers. */
export function amountHeader(label = "Amount"): string {
  return `${label} (${exportCurrencySymbol()})`;
}

/** SheetJS numFmt for currency cells. Uses Indian lakh grouping for INR. */
export function excelCurrencyFmt(): string {
  const sym = exportCurrencySymbol();
  // Escape characters that have special meaning in numFmt strings
  const s = sym.replace(/([\\$#0?])/g, "\\$1");
  const grouping = getCurrentCurrencyCode() === "INR" ? "#,##,##0.00" : "#,##0.00";
  return `"${s}" ${grouping};[Red]-"${s}" ${grouping}`;
}

/** SheetJS numFmt for date cells, derived from the global date format. */
export function excelDateFmt(code: DateFormatCode = getCurrentDateFormat()): string {
  switch (code) {
    case "dd/mm/yyyy": return "dd/mm/yyyy";
    case "mm-dd-yyyy": return "mm-dd-yyyy";
    case "mm/dd/yyyy": return "mm/dd/yyyy";
    case "yyyy-mm-dd": return "yyyy-mm-dd";
    case "dd-mmm-yyyy": return "dd-mmm-yyyy";
    case "dd-mm-yyyy":
    default: return "dd-mm-yyyy";
  }
}

/** Build a numeric XLSX cell from a paise integer with the company currency numFmt. */
export function moneyCell(paise: number | null | undefined): XLSX.CellObject {
  const n = typeof paise === "number" && Number.isFinite(paise) ? paise / 100 : 0;
  return { t: "n", v: n, z: excelCurrencyFmt() };
}

/** Build a plain numeric XLSX cell (no currency symbol) from paise. */
export function numberCell(paise: number | null | undefined, digits = 2): XLSX.CellObject {
  const n = typeof paise === "number" && Number.isFinite(paise) ? paise / 100 : 0;
  const z = digits === 0 ? "#,##0" : `#,##0.${"0".repeat(digits)}`;
  return { t: "n", v: n, z };
}

/** Build a real Excel date cell from an ISO string / Date. */
export function dateCell(d: string | Date | null | undefined): XLSX.CellObject {
  const parsed = d instanceof Date ? d : parseAppDate(d ?? null);
  if (!parsed) return { t: "s", v: "" };
  return { t: "d", v: parsed, z: excelDateFmt() };
}

// ---------------------------------------------------------------------------
// Heuristic auto-promotion — applied by downloadXlsx as a safety net for the
// many existing reports that still emit pre-formatted strings. Cells that
// look like "<symbol> 1,23,456.78" become numbers with the currency numFmt;
// cells matching the active date format become real dates.
// ---------------------------------------------------------------------------

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function promoteCell(cell: unknown): unknown {
  if (cell == null) return cell;
  if (typeof cell !== "string") return cell;
  const sym = exportCurrencySymbol();
  const symEsc = escapeForRegex(sym);

  // Currency: "₹ 1,23,456.78" or "-₹ 1,23,456.78" or "₹ 1,23,456.78 Dr"
  const moneyRe = new RegExp(
    `^\\s*(-?)\\s*${symEsc}\\s*([0-9](?:[0-9,]*\\d)?(?:\\.\\d+)?)(?:\\s*(Dr|Cr))?\\s*$`,
  );
  const mm = moneyRe.exec(cell);
  if (mm) {
    const sign = mm[1] === "-" ? -1 : 1;
    const drCr = mm[3] === "Cr" ? -1 : 1;
    const n = parseFloat(mm[2].replace(/,/g, ""));
    if (Number.isFinite(n)) return { t: "n", v: sign * drCr * n, z: excelCurrencyFmt() };
  }

  // Plain Indian-grouped number with no symbol (e.g. trial-balance amounts with symbol:false)
  const plainRe = /^\s*(-?)\s*([0-9](?:[0-9,]*\d)?\.\d{2})\s*(Dr|Cr)?\s*$/;
  const pm = plainRe.exec(cell);
  if (pm) {
    const n = parseFloat(pm[2].replace(/,/g, ""));
    if (Number.isFinite(n)) {
      const sign = pm[1] === "-" ? -1 : 1;
      const drCr = pm[3] === "Cr" ? -1 : 1;
      return { t: "n", v: sign * drCr * n, z: "#,##0.00" };
    }
  }

  // Date: try to parse using the app's tolerant parser
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(cell) || /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(cell)) {
    const d = parseAppDate(cell);
    if (d) return { t: "d", v: d, z: excelDateFmt() };
  }

  return cell;
}

export function promoteRows<T>(rows: T[][]): unknown[][] {
  return rows.map((row) => row.map((c) => promoteCell(c as unknown)));
}
