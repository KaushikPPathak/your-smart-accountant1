// MSMED Act §15/§16 — interest on delayed payments to Micro & Small Enterprises.
//
// §15: buyer must pay MSE supplier on or before the "appointed day":
//   - the date agreed in writing, OR
//   - 45 days from the day of acceptance/deemed acceptance,
//   whichever is EARLIER.
//
// §16: on failure, buyer is liable to pay COMPOUND interest with MONTHLY
// rests, at THREE TIMES the RBI-notified bank rate, from the day
// immediately following the appointed day.
//
// This helper is pure and works in paise. Callers pass the current RBI bank
// rate (annual %). Default 6.75% (bank rate as of most recent RBI review) can
// be overridden per company from Settings.

export const DEFAULT_RBI_BANK_RATE_PCT = 6.75;

/** MSMED §16 statutory rate = 3 × RBI bank rate (annual %). */
export function msmedRatePct(bankRatePct = DEFAULT_RBI_BANK_RATE_PCT): number {
  return bankRatePct * 3;
}

/**
 * Appointed day per §2(b) / §15 — earlier of (agreed due date, invoice + 45d).
 * ISO date strings in, ISO date string out.
 */
export function appointedDay(invoiceDateIso: string, agreedDueDateIso?: string | null): string {
  const inv = new Date(invoiceDateIso);
  const cap = new Date(inv);
  cap.setDate(cap.getDate() + 45);
  if (!agreedDueDateIso) return cap.toISOString().slice(0, 10);
  const agreed = new Date(agreedDueDateIso);
  const chosen = agreed.getTime() < cap.getTime() ? agreed : cap;
  return chosen.toISOString().slice(0, 10);
}

/**
 * Compound interest with monthly rests from (appointedDay + 1) to `asOfIso`.
 * Formula: P * ((1 + r/12) ^ months  -  1)  +  daily-simple stub for the
 * partial trailing month, so the client sees a rising figure day-by-day
 * instead of stepping only at month-ends.
 *
 * Returns the interest amount in paise (rounded to nearest paisa).
 * Returns 0 if not yet overdue.
 */
export function msmedInterestPaise(
  principalPaise: number,
  invoiceDateIso: string,
  asOfIso: string,
  opts: { agreedDueDate?: string | null; bankRatePct?: number } = {},
): number {
  if (principalPaise <= 0) return 0;
  const bankRate = opts.bankRatePct ?? DEFAULT_RBI_BANK_RATE_PCT;
  const rate = (bankRate * 3) / 100; // annual, decimal
  if (rate <= 0) return 0;

  const appointed = new Date(appointedDay(invoiceDateIso, opts.agreedDueDate));
  const start = new Date(appointed);
  start.setDate(start.getDate() + 1); // "from the day immediately following"
  const asOf = new Date(asOfIso);
  if (asOf.getTime() <= start.getTime()) return 0;

  const totalDays = Math.floor((asOf.getTime() - start.getTime()) / 86400000);
  const fullMonths = Math.floor(totalDays / 30);
  const stubDays = totalDays - fullMonths * 30;

  const monthly = rate / 12;
  const compounded = principalPaise * (Math.pow(1 + monthly, fullMonths) - 1);
  const stubPrincipal = principalPaise * Math.pow(1 + monthly, fullMonths);
  const stub = stubPrincipal * rate * (stubDays / 365);
  return Math.round(compounded + stub);
}

/** Human-readable breakdown for tooltips / audit. */
export function msmedInterestBreakdown(
  principalPaise: number,
  invoiceDateIso: string,
  asOfIso: string,
  opts: { agreedDueDate?: string | null; bankRatePct?: number } = {},
) {
  const bankRate = opts.bankRatePct ?? DEFAULT_RBI_BANK_RATE_PCT;
  const appointed = appointedDay(invoiceDateIso, opts.agreedDueDate);
  const interest = msmedInterestPaise(principalPaise, invoiceDateIso, asOfIso, opts);
  const daysLate = Math.max(
    0,
    Math.floor((new Date(asOfIso).getTime() - new Date(appointed).getTime()) / 86400000),
  );
  return {
    appointedDay: appointed,
    daysLate,
    ratePct: bankRate * 3,
    bankRatePct: bankRate,
    interestPaise: interest,
  };
}
