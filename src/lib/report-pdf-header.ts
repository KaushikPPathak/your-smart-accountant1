import { useCompany } from "./company-context";

/**
 * Returns the company / proprietor name and a financial-year sub-line
 * to inject into every PDF report header. Keeps the proprietor's name on
 * every printed page (Day Book, Cash/Bank Book, Ledger, etc.).
 */
export function useReportPdfHeader(): { companyName: string; companySubLine: string } {
  const { activeMembership } = useCompany();
  const companyName = activeMembership?.companies?.name ?? "";
  const fyStart = activeMembership?.companies?.financial_year_start ?? null;
  const gstin = activeMembership?.companies?.gstin ?? null;
  const fyText = formatFyRange(fyStart);
  const sub = [fyText, gstin ? `GSTIN: ${gstin}` : null].filter(Boolean).join("  ·  ");
  return { companyName, companySubLine: sub };
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