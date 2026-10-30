// Excel serial-date helpers (1900 date system, UTC-based).
// Dependency-free so it can be imported from workers without pulling ExcelJS in.

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export interface ExcelDateParts {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
  H: number;
  M: number;
  S: number;
}

/** Replacement for SheetJS `SSF.parse_date_code`. Returns null for non-date serials. */
export function excelSerialParts(serial: number): ExcelDateParts | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const whole = Math.floor(serial);
  const ms = EPOCH_MS + whole * DAY_MS + Math.round((serial - whole) * DAY_MS);
  const dt = new Date(ms);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    H: dt.getUTCHours(),
    M: dt.getUTCMinutes(),
    S: dt.getUTCSeconds(),
  };
}

/** Excel serial number for a Date (inverse of excelSerialParts). */
export function dateToExcelSerial(date: Date): number {
  return (date.getTime() - EPOCH_MS) / DAY_MS;
}
