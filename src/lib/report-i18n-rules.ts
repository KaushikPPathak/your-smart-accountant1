// Rule-based template translator for printed/displayed report text.
// `tReportText` handles dynamic strings that the static dictionary in
// report-i18n.ts can't capture verbatim — things like
//   "for the period 2025-04-01 to 2026-03-31"
//   "As on 31-03-2026"
//   "Page 3 of 12"
//   "Sales — ACME Traders"
//   "0-30 days"
//   "FY 2025-26 (01-04-2025 to 31-03-2026)"
// without mangling free-form text like ledger / party names.
import { fmtIndianDate } from "@/lib/format-date";
import { getStoredLang, type LangCode } from "@/lib/i18n";
import { LABELS, tReportLabel } from "@/lib/report-i18n";

type Rule = { test: RegExp; build: (m: RegExpExecArray, lang: LangCode) => string };

// Detect strings that look like a date so we can normalize to DD-MM-YYYY
// without routing them through the dictionary.
function maybeDate(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(s)) {
    return fmtIndianDate(s);
  }
  return s;
}

const RULES: Rule[] = [
  // "for the period 2025-04-01 to 2026-03-31"
  {
    test: /^for the period:?\s+(\S+)\s+(?:to|થી|–|—)\s+(\S+)$/i,
    build: (m, lang) =>
      lang === "gu"
        ? `આ સમયગાળા માટે: ${fmtIndianDate(m[1])} થી ${fmtIndianDate(m[2])}`
        : `For the period: ${fmtIndianDate(m[1])} to ${fmtIndianDate(m[2])}`,
  },
  // "As on 2026-03-31" / "As at 2026-03-31"
  {
    test: /^As (?:on|at)\s+(.+)$/,
    build: (m, lang) =>
      lang === "gu" ? `તા. ${fmtIndianDate(m[1])} ના રોજ` : `As on ${fmtIndianDate(m[1])}`,
  },
  // "Page 3 of 12"
  {
    test: /^Page\s+(\d+)\s+of\s+(\d+)$/i,
    build: (m, lang) => (lang === "gu" ? `પાનું ${m[1]} / ${m[2]}` : `Page ${m[1]} of ${m[2]}`),
  },
  // "GSTIN: …" — keep value, both langs
  {
    test: /^GSTIN:\s*(.+)$/,
    build: (m) => `GSTIN: ${m[1]}`,
  },
  // "FY 2025-26 (01-04-2025 to 31-03-2026)"
  {
    test: /^FY\s+(\d{4}-\d{2})\s*\((.+)\s+to\s+(.+)\)$/,
    build: (m, lang) =>
      lang === "gu"
        ? `નાણાકીય વર્ષ ${m[1]} (${fmtIndianDate(m[2])} થી ${fmtIndianDate(m[3])})`
        : `FY ${m[1]} (${fmtIndianDate(m[2])} to ${fmtIndianDate(m[3])})`,
  },
  // "FY 2025-26"
  {
    test: /^FY\s+(\d{4}-\d{2})$/,
    build: (m, lang) => (lang === "gu" ? `નાણાકીય વર્ષ ${m[1]}` : `FY ${m[1]}`),
  },
  // Ageing buckets: "0-30 days", "31–60 days"
  {
    test: /^(\d+)\s*[-–]\s*(\d+)\s*days?$/i,
    build: (m, lang) => (lang === "gu" ? `${m[1]}–${m[2]} દિવસ` : `${m[1]}–${m[2]} days`),
  },
  // "90+ days"
  {
    test: /^(\d+)\+\s*days?$/i,
    build: (m, lang) => (lang === "gu" ? `${m[1]}+ દિવસ` : `${m[1]}+ days`),
  },
  // "Subtotal — Indirect Expenses" / "Ledger A/c — ACME Traders" / "Sales — ACME"
  {
    test: /^(.+?)\s+[—–-]\s+(.+)$/,
    build: (m, lang) => `${tReportText(m[1], lang)} — ${tReportText(m[2], lang)}`,
  },
  // "Closing Balance: 1,23,456.00" — translate label, keep value
  {
    test: /^([A-Za-z][A-Za-z .&/()-]+):\s+(.+)$/,
    build: (m, lang) => `${tReportText(m[1], lang)}: ${maybeDate(m[2])}`,
  },
];

/**
 * Translate a free-form printed/displayed string. Tries the exact dictionary
 * first, then a small set of regex templates. Falls back to the original
 * text (or a date-normalized version of it) so user data — party names,
 * narrations, item descriptions — never get mangled.
 */
export function tReportText(text: string, lang: LangCode = getStoredLang()): string {
  if (!text) return text;
  if (lang === "en") {
    // English path: still normalize embedded date tokens to DD-MM-YYYY.
    return formatEmbeddedDates(text);
  }
  const trimmed = text.trim();
  const leading = text.match(/^\s*/)?.[0] ?? "";

  // 1. Exact dictionary hit (cheapest, most precise).
  const exact = LABELS[trimmed]?.[lang];
  if (exact) return leading + exact;

  // 2. Rule templates.
  for (const r of RULES) {
    const m = r.test.exec(trimmed);
    if (m) return leading + r.build(m, lang);
  }

  // 3. Fall back to dictionary's looser matcher (handles "To/By X" etc.).
  const looser = tReportLabel(trimmed, lang);
  if (looser !== trimmed) return leading + looser;

  // 4. Last resort: just normalize any date tokens inside otherwise-free text.
  return leading + formatEmbeddedDates(trimmed);
}

function formatEmbeddedDates(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g, (m) =>
    fmtIndianDate(m),
  );
}
