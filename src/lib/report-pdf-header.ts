import { useCompany } from "./company-context";
import { getStoredLang } from "./i18n";

/**
 * Returns the company / proprietor name and a financial-year sub-line
 * to inject into every PDF report header. Keeps the proprietor's name on
 * every printed page (Day Book, Cash/Bank Book, Ledger, etc.).
 */
export function useReportPdfHeader(): {
  companyName: string;
  companySubLine: string;
  fyStart: string | null;
  fyEnd: string | null;
  /** Returns the date-range subtitle only when it differs from the FY range, to avoid duplicating the line printed under the company name. */
  dateRangeSubtitle: (from: string, to: string) => string;
} {
  const { activeMembership } = useCompany();
  const companyName = activeMembership?.companies?.name ?? "";
  const fyStart = activeMembership?.companies?.financial_year_start ?? null;
  const gstin = activeMembership?.companies?.gstin ?? null;
  const fyText = formatFyRange(fyStart);
  const sub = [fyText, gstin ? `GSTIN: ${gstin}` : null].filter(Boolean).join("  ·  ");
  const fyEnd = fyEndFromStart(fyStart);
  const dateRangeSubtitle = (from: string, to: string) => {
    if (fyStart && fyEnd && from === fyStart && to === fyEnd) return "";
    const sep = getStoredLang() === "gu" ? "થી" : "to";
    return `${fmtDmy(from)} ${sep} ${fmtDmy(to)}`;
  };
  return { companyName, companySubLine: sub, fyStart, fyEnd, dateRangeSubtitle };
}

function fyEndFromStart(start: string | null | undefined): string | null {
  if (!start) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return null;
  return `${Number(m[1]) + 1}-03-31`;
}

function fmtDmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function formatFyRange(start: string | null | undefined): string {
  if (!start) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = m[2];
  const d = m[3];
  const endY = y + 1;
  return `${d}/${mo}/${y} to 31/03/${endY}`;
}