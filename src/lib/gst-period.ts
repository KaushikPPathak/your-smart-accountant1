// Report periods for the GST screens. Any range can be reported on screen
// (1 month, 2 months, a quarter, 3 months, any N months, or any date range).
// Filing files (GSTN JSON, the GSTR-3B utility) are only produced for a single
// return period: one month, or one quarter starting in Apr, Jul, Oct or Jan.
import { monthRange, periodFP, quarterRange } from "./gst-returns";

export type GstPeriodMode = "month" | "quarter" | "months" | "range";

export interface GstPeriodSelection {
  mode: GstPeriodMode;
  /** "YYYY-MM" — the month (month mode) or the first month (months mode). */
  month: string;
  /** Quarter number, used in quarter mode. */
  quarter: 1 | 2 | 3 | 4;
  /** Calendar year containing the chosen quarter. */
  quarterYear: number;
  /** Months mode: how many months from `month` (1–12). */
  count: number;
  /** Range mode: "YYYY-MM-DD". */
  from: string;
  to: string;
}

export interface ResolvedGstPeriod {
  valid: boolean;
  /** Human-readable label, e.g. "Apr 2026 – Jun 2026 (3 months)". */
  label: string;
  from: string;
  to: string;
  /** Number of calendar months covered (partial months count as one). */
  months: number;
  /** Return period key (MMYYYY) used for single-return data and filenames. */
  fp: string;
  /** Every month key (MMYYYY) in the range, in order. */
  fps: string[];
  /** True when the range is exactly one return period (month or quarter). */
  singleReturn: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymParts(ym: string): { y: number; m: number } {
  const [y, m] = ym.split("-").map(Number);
  return { y, m };
}

/** Add `n` months to "YYYY-MM" and return "YYYY-MM". */
export function addMonths(ym: string, n: number): string {
  const { y, m } = ymParts(ym);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month keys (MMYYYY) between two ISO dates, inclusive. */
export function fpsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = from.slice(0, 7);
  const end = to.slice(0, 7);
  let cur = start;
  while (cur <= end) {
    const { y, m } = ymParts(cur);
    out.push(`${String(m).padStart(2, "0")}${y}`);
    cur = addMonths(cur, 1);
    if (out.length > 600) break; // guard against a bad range
  }
  return out;
}

function lastDayOf(ym: string): string {
  return monthRange(ym).to;
}

export function resolveGstPeriod(sel: GstPeriodSelection): ResolvedGstPeriod {
  const invalid: ResolvedGstPeriod = { valid: false, label: "", from: "", to: "", months: 0, fp: "", fps: [], singleReturn: false };
  let from = "";
  let to = "";
  let label = "";

  if (sel.mode === "month") {
    const r = monthRange(sel.month);
    from = r.from;
    to = r.to;
    label = monthLabel(sel.month);
  } else if (sel.mode === "quarter") {
    const r = quarterRange(sel.quarterYear, sel.quarter);
    from = r.from;
    to = r.to;
    const first = Number(from.slice(5, 7));
    label = `Q${sel.quarter} (${MONTHS[first - 1]}–${MONTHS[first + 1]} ${from.slice(0, 4)})`;
  } else if (sel.mode === "months") {
    const count = Math.min(Math.max(Math.trunc(sel.count) || 1, 1), 60);
    const endYm = addMonths(sel.month, count - 1);
    from = `${sel.month}-01`;
    to = lastDayOf(endYm);
    label = count === 1 ? monthLabel(sel.month) : `${monthLabel(sel.month)} – ${monthLabel(endYm)} (${count} months)`;
  } else {
    if (!sel.from || !sel.to || sel.to < sel.from) return invalid;
    from = sel.from;
    to = sel.to;
    label = `${sel.from} to ${sel.to}`;
  }

  const fps = fpsInRange(from, to);
  const months = fps.length;
  const fromIsMonthStart = from.endsWith("-01");
  const toIsMonthEnd = to === lastDayOf(to.slice(0, 7));
  const startMonth = Number(from.slice(5, 7));
  const singleReturn =
    fromIsMonthStart && toIsMonthEnd && (months === 1 || (months === 3 && [1, 4, 7, 10].includes(startMonth)));
  // Quarterly (QRMP) returns are keyed by their last month, as before; everything else by the first.
  const fp = singleReturn && months === 3 ? (fps[fps.length - 1] ?? "") : (fps[0] ?? "");

  return { valid: true, label, from, to, months, fp, fps, singleReturn };
}

function monthLabel(ym: string): string {
  const { y, m } = ymParts(ym);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Selection for a filing frequency chosen in Settings. */
export function defaultSelection(frequency: "monthly" | "quarterly", today: Date = new Date()): GstPeriodSelection {
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  // FY quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.
  const fyQuarterOf = (monthIndex: number): 1 | 2 | 3 | 4 => {
    if (monthIndex >= 3 && monthIndex <= 5) return 1;
    if (monthIndex >= 6 && monthIndex <= 8) return 2;
    if (monthIndex >= 9 && monthIndex <= 11) return 3;
    return 4;
  };
  const quarter = fyQuarterOf(today.getMonth());
  return {
    mode: frequency === "quarterly" ? "quarter" : "month",
    month: ym,
    quarter,
    quarterYear: today.getFullYear(),
    count: 1,
    from: `${ym}-01`,
    to: lastDayOf(ym),
  };
}

export { periodFP };

/**
 * Sum inward-supply rows from several months into one row per type. The GSTR-3B
 * builder reads one row per type, so a range is merged here first.
 */
export function mergeInwardSummaries<T extends { ty: string; inter_paise: number; intra_paise: number }>(rows: T[]): T[] {
  const byTy = new Map<string, T>();
  for (const r of rows) {
    const prev = byTy.get(r.ty);
    if (!prev) byTy.set(r.ty, { ...r });
    else {
      prev.inter_paise += r.inter_paise;
      prev.intra_paise += r.intra_paise;
    }
  }
  return [...byTy.values()];
}
