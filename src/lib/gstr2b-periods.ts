// Period handling for GSTR-2B imports. Pure functions, no storage.
//
// A stored line or import can carry its return period in several shapes:
//   "042026"      MMYYYY (GSTN style)
//   "04-2026", "04/2026", "Apr-2026", "Apr 2026"
//   "2025-26"     a financial year (yearly workbook)
// Anything we cannot read is treated as "unknown", and unknown lines stay visible
// in every range rather than being silently dropped.
import { addMonths, fpsInRange } from "@/lib/gst-period";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export type G2bPeriod =
  | { kind: "month"; fp: string; ym: string }
  | { kind: "fy"; from: string; to: string };

export function normaliseG2bPeriod(raw: string | null | undefined): G2bPeriod | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  let m = /^(\d{2})(\d{4})$/.exec(s);
  if (m) return monthPeriod(Number(m[1]), Number(m[2]));

  m = /^(\d{1,2})[-/ ](\d{4})$/.exec(s);
  if (m) return monthPeriod(Number(m[1]), Number(m[2]));

  m = /^([A-Za-z]{3})[a-z]*[-/ ](\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return monthPeriod(mo, Number(m[2]));
  }

  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const start = Number(m[1]);
    const end2 = Number(m[2]);
    // "2025-26" is a financial year; "2026-04" would be a year-month, handled above only if it is not a valid FY.
    if (end2 === (start + 1) % 100) return fy(start);
    if (end2 >= 1 && end2 <= 12) return monthPeriod(end2, start);
  }

  return null;
}

function monthPeriod(mm: number, yyyy: number): G2bPeriod | null {
  if (mm < 1 || mm > 12 || yyyy < 2000 || yyyy > 2100) return null;
  const ym = `${yyyy}-${String(mm).padStart(2, "0")}`;
  return { kind: "month", fp: `${String(mm).padStart(2, "0")}${yyyy}`, ym };
}

function fy(startYear: number): G2bPeriod {
  return { kind: "fy", from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/** True when a line (or, if it has none, its import) belongs to the selected range. */
export function g2bPeriodInRange(
  linePeriod: string | null | undefined,
  importPeriod: string | null | undefined,
  range: { fps: string[]; from: string; to: string },
): boolean {
  const p = normaliseG2bPeriod(linePeriod) ?? normaliseG2bPeriod(importPeriod);
  if (!p) return true;
  if (p.kind === "month") return range.fps.includes(p.fp);
  return p.from <= range.to && p.to >= range.from;
}

/** The month (YYYY-MM) a line belongs to, or null for a financial-year or unknown period. */
export function g2bMonthOf(linePeriod: string | null | undefined, importPeriod: string | null | undefined): string | null {
  const p = normaliseG2bPeriod(linePeriod) ?? normaliseG2bPeriod(importPeriod);
  return p && p.kind === "month" ? p.ym : null;
}

/** Every month (YYYY-MM) a line or import covers: one for a month period, twelve for a financial year. */
export function monthsCoveredBy(linePeriod: string | null | undefined, importPeriod: string | null | undefined): string[] {
  const p = normaliseG2bPeriod(linePeriod) ?? normaliseG2bPeriod(importPeriod);
  if (!p) return [];
  if (p.kind === "month") return [p.ym];
  const startYm = p.from.slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => addMonths(startYm, i));
}

/** For a range, which of its months have GSTR-2B data and which are still missing. */
export function coverageForRange(
  monthsWithData: Set<string>,
  range: { from: string; to: string },
): { ym: string; imported: boolean }[] {
  const fps = fpsInRange(range.from, range.to); // MMYYYY values, in order
  return fps.map((fp) => {
    const ym = `${fp.slice(2)}-${fp.slice(0, 2)}`;
    return { ym, imported: monthsWithData.has(ym) };
  });
}
