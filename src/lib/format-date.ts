/**
 * Format an ISO date string (YYYY-MM-DD or full ISO timestamp) into the
 * Indian display convention DD-MM-YYYY. Returns the input unchanged if
 * it does not start with a recognisable date.
 *
 * Use this helper EVERYWHERE a date is shown to the user (tables, lists,
 * PDF/CSV exports, hints, tooltips). Storage and query payloads keep the
 * canonical YYYY-MM-DD format.
 */
export function fmtIndianDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[3]}-${m[2]}-${m[1]}`;
}
