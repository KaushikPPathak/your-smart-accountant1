/**
 * Voucher numbering engine (local-only, pure functions).
 *
 * Indian accounting convention allows a wide range of document-numbering
 * styles. This module models the common ones with one small rule object per
 * (company, voucher_type):
 *
 *   prefix • FY token • month token • zero-padded serial • suffix
 *
 * Everything is optional, so a rule can produce plain "1", "INV-0001",
 * "INV/25-26/0007", "SI/2026/04/012" and so on.
 *
 * The engine never touches storage — see `src/lib/voucher-prefs.ts`.
 */

export type ResetPeriod = "never" | "yearly" | "monthly";

export interface NumberingRule {
  /** Leading text, e.g. "INV". Empty = none. */
  prefix: string;
  /** Trailing text, e.g. "A". Empty = none. */
  suffix: string;
  /** Zero padding width of the serial. 1 = no padding. */
  width: number;
  /** First serial used when the counter starts / resets. */
  start: number;
  /** When the serial restarts. */
  reset: ResetPeriod;
  /** Character between parts. Usually "-", "/" or "" . */
  separator: string;
  /** Insert the financial-year token (e.g. 25-26). */
  includeFy: boolean;
  /** Insert the 2-digit month token (e.g. 04). */
  includeMonth: boolean;
}

export const DEFAULT_RULE: NumberingRule = {
  prefix: "",
  suffix: "",
  width: 1,
  start: 1,
  reset: "never",
  separator: "/",
  includeFy: false,
  includeMonth: false,
};

export interface NumberingPreset {
  id: string;
  label: string;
  hint: string;
  rule: NumberingRule;
}

export const NUMBERING_PRESETS: NumberingPreset[] = [
  {
    id: "plain",
    label: "Plain serial",
    hint: "1, 2, 3 …",
    rule: { ...DEFAULT_RULE },
  },
  {
    id: "padded",
    label: "Padded serial",
    hint: "0001, 0002 …",
    rule: { ...DEFAULT_RULE, width: 4 },
  },
  {
    id: "prefix",
    label: "Prefix + serial",
    hint: "INV-0001",
    rule: { ...DEFAULT_RULE, prefix: "INV", separator: "-", width: 4 },
  },
  {
    id: "fy",
    label: "Prefix + financial year",
    hint: "INV/25-26/0001, restarts every FY",
    rule: { ...DEFAULT_RULE, prefix: "INV", includeFy: true, width: 4, reset: "yearly" },
  },
  {
    id: "fy_month",
    label: "Financial year + month",
    hint: "INV/25-26/04/001, restarts monthly",
    rule: {
      ...DEFAULT_RULE,
      prefix: "INV",
      includeFy: true,
      includeMonth: true,
      width: 3,
      reset: "monthly",
    },
  },
];

/** Indian FY label for a date, e.g. 2026-04-05 → "26-27". */
export function fyToken(dateIso: string, fyStartMonth = 4): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const startYear = m >= fyStartMonth ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `${two(startYear)}-${two(startYear + 1)}`;
}

function monthToken(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getMonth() + 1).padStart(2, "0");
}

/**
 * Scope key for the reset period. Two vouchers share a counter only when
 * their scope keys match.
 */
export function scopeKey(rule: NumberingRule, dateIso: string, fyStartMonth = 4): string {
  if (rule.reset === "yearly") return `fy:${fyToken(dateIso, fyStartMonth)}`;
  if (rule.reset === "monthly") {
    return `fy:${fyToken(dateIso, fyStartMonth)}|m:${monthToken(dateIso)}`;
  }
  return "all";
}

export function formatVoucherNumber(
  rule: NumberingRule,
  opts: { seq: number; date: string; fyStartMonth?: number },
): string {
  const r = { ...DEFAULT_RULE, ...rule };
  const parts: string[] = [];
  if (r.prefix.trim()) parts.push(r.prefix.trim());
  if (r.includeFy) {
    const t = fyToken(opts.date, opts.fyStartMonth ?? 4);
    if (t) parts.push(t);
  }
  if (r.includeMonth) {
    const t = monthToken(opts.date);
    if (t) parts.push(t);
  }
  parts.push(String(Math.max(1, opts.seq)).padStart(Math.max(1, r.width), "0"));
  if (r.suffix.trim()) parts.push(r.suffix.trim());
  return parts.join(r.separator ?? "");
}

/** Trailing digit group of a formatted number, or null. */
export function extractSerial(voucherNumber: string): number | null {
  const m = String(voucherNumber ?? "").match(/(\d+)(?!.*\d)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Next serial for a rule, given the vouchers that already exist.
 * Only vouchers in the same reset scope (and sharing the prefix, when one is
 * configured) participate, so switching styles mid-year never renumbers or
 * collides with past documents.
 */
export function nextSerial(
  rule: NumberingRule,
  existing: Array<{ voucher_number: string; voucher_date: string }>,
  forDate: string,
  fyStartMonth = 4,
): number {
  const r = { ...DEFAULT_RULE, ...rule };
  const wantScope = scopeKey(r, forDate, fyStartMonth);
  const prefix = r.prefix.trim().toLowerCase();
  let max = 0;
  for (const row of existing) {
    const num = String(row?.voucher_number ?? "");
    if (!num) continue;
    if (scopeKey(r, row?.voucher_date ?? forDate, fyStartMonth) !== wantScope) continue;
    if (prefix && !num.toLowerCase().startsWith(prefix)) continue;
    const s = extractSerial(num);
    if (s != null && s > max) max = s;
  }
  return Math.max(max + 1, Math.max(1, r.start));
}

/** Convenience: full next number for a rule. */
export function nextVoucherNumberFor(
  rule: NumberingRule,
  existing: Array<{ voucher_number: string; voucher_date: string }>,
  forDate: string,
  fyStartMonth = 4,
): string {
  const seq = nextSerial(rule, existing, forDate, fyStartMonth);
  return formatVoucherNumber(rule, { seq, date: forDate, fyStartMonth });
}

export function sampleNumber(rule: NumberingRule, dateIso?: string): string {
  const date = dateIso ?? new Date().toISOString().slice(0, 10);
  return formatVoucherNumber(rule, { seq: Math.max(1, rule.start), date });
}
