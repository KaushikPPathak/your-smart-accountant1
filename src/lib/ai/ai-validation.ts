// Date handling for the AI assistant. Arguments that come from a language model are checked
// strictly; dates read from stored books are normalised, so "2025-4-5" sorts with "2025-04-05".

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A date argument: missing means "not given"; anything else must be a real YYYY-MM-DD. */
export function coerceDateArg(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const t = value.trim();
  return isRealIsoDate(t) ? { ok: true, value: t } : { ok: false };
}

export const DATE_ARG_KEYS = ["asOn", "from", "to"] as const;

/** Error text when a date argument is malformed, otherwise null. */
export function validateDateArgs(args: Record<string, unknown>): string | null {
  for (const key of DATE_ARG_KEYS) {
    const v = args[key];
    if (v === undefined || v === null || v === "") continue;
    if (!coerceDateArg(v).ok) {
      return `${key} must be a real date in YYYY-MM-DD form (got ${JSON.stringify(String(v))})`;
    }
  }
  return null;
}

/** Stored voucher date to YYYY-MM-DD. Accepts unpadded "2025-4-5" and a time suffix; "" if unusable. */
export function normalizeStoredDate(value: unknown): string {
  const text = String(value ?? "").trim();
  // Indian day-first form, as typed in the assistant prompt: 15/03/2026 or 15-03-2026.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return isRealIsoDate(iso) ? iso : "";
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (!m) return "";
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isRealIsoDate(iso) ? iso : "";
}
