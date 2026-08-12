/** App-wide date formatting utilities.
 * Storage/query payloads stay ISO (YYYY-MM-DD); every human-facing report,
 * print, export and picker display uses the user's globally chosen format
 * (default DD-MM-YYYY).
 */
import { applyDateFormat } from "./date-format";

export function parseAppDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  const s = String(value).trim();
  let y: number;
  let m: number;
  let d: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(s);
    if (!dmy) return null;
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
    if (y < 100) y += 2000;
  }

  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return null;
  return parsed;
}

export function fmtIndianDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = parseAppDate(value);
  if (!d) return String(value);
  return applyDateFormat(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function formatDateRange(from: string | null | undefined, to: string | null | undefined, sep = "to"): string {
  return `${fmtIndianDate(from)} ${sep} ${fmtIndianDate(to)}`.trim();
}

export function formatDatesInText(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/g, (match) => fmtIndianDate(match));
}
