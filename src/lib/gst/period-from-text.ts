// The period a question names, read only when the question names one. A GST figure attached to the
// wrong month is worse than no figure, so a missing or ambiguous month is never inferred here: the
// caller asks the user to choose from the candidates.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "YYYY-MM" when the text names a month with its year ("2026-10", "Oct 2026", "October 2026"); otherwise undefined. */
export function explicitMonthFromText(text: string): string | undefined {
  const iso = /\b(\d{4})-(\d{1,2})\b/.exec(text);
  if (iso) {
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${iso[1]}-${String(m).padStart(2, "0")}`;
  }
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i.exec(text);
  if (named) {
    const m = MONTHS[named[1].toLowerCase()];
    return `${named[2]}-${String(m).padStart(2, "0")}`;
  }
  return undefined;
}

export interface MonthChoice {
  month: string;
  label: string;
}

const LABEL = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]} ${y}`;
};

/** The most recent completed months, newest first, offered when the question does not name one. */
export function recentCompletedMonths(today: Date, count = 3): MonthChoice[] {
  const out: MonthChoice[] = [];
  let y = today.getFullYear();
  let m = today.getMonth(); // 0-based index of the current month; the previous month is m - 1
  for (let i = 0; i < count; i++) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
    out.push({ month: ym, label: LABEL(ym) });
  }
  return out;
}

export { LABEL as monthLabel };
