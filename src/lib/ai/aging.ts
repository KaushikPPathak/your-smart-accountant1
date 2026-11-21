// Ageing of receivables and payables for one party. Pure arithmetic on paise.
//
// Method (state it in every answer): each receipt (for receivables) or payment (for payables) is
// settled against the oldest open bill first, first-in first-out. Opening balances have no date and
// go to the "opening" bucket. Days are counted from each open bill's date to the as-on date.

export type AgingBucket = "opening" | "d0_30" | "d31_60" | "d61_90" | "d90p";
export type AgingSide = "receivable" | "payable";

export interface DatedEntry {
  /** YYYY-MM-DD */
  date: string;
  debitPaise: number;
  creditPaise: number;
}

export interface AgedOutstanding {
  /** Amount still owed, always positive. */
  outstandingPaise: number;
  /** Money received or paid in advance and not yet matched to a bill. */
  advancePaise: number;
  buckets: Record<AgingBucket, number>;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function bucketFor(days: number): Exclude<AgingBucket, "opening"> {
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90p";
}

/**
 * @param openingPaise  opening balance, signed in the party's own direction: positive means the
 *                      party owes us (receivable) or we owe the party (payable).
 * @param entries       postings on or before asOn, sorted by date ascending.
 */
export function ageOutstanding(
  side: AgingSide,
  openingPaise: number,
  entries: DatedEntry[],
  asOn: string,
): AgedOutstanding {
  // A bill is money the party owes us (receivable) or we owe them (payable).
  // Receivable bills are increased by debits; payable bills by credits.
  const billSign = side === "receivable" ? 1 : -1;
  const bills: { date: string | null; amount: number }[] = [];
  let advance = 0;

  const addBill = (date: string | null, amount: number) => {
    if (amount > 0) bills.push({ date, amount });
  };
  const settle = (amount: number) => {
    let remaining = amount;
    while (remaining > 0 && bills.length) {
      const bill = bills[0];
      const take = Math.min(bill.amount, remaining);
      bill.amount -= take;
      remaining -= take;
      if (bill.amount === 0) bills.shift();
    }
    advance += remaining; // more received or paid than was billed
  };

  // Opening balance in the party's direction.
  if (openingPaise * billSign > 0) addBill(null, openingPaise * billSign);
  else if (openingPaise * billSign < 0) advance += -openingPaise * billSign;

  for (const e of entries) {
    const billing = billSign > 0 ? e.debitPaise : e.creditPaise; // raises what is owed
    const paying = billSign > 0 ? e.creditPaise : e.debitPaise; // reduces what is owed
    if (billing > 0) addBill(e.date, billing);
    if (paying > 0) settle(paying);
  }

  const buckets: AgedOutstanding["buckets"] = { opening: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  let outstanding = 0;
  for (const b of bills) {
    outstanding += b.amount;
    if (b.date === null) buckets.opening += b.amount;
    else buckets[bucketFor(daysBetween(b.date, asOn))] += b.amount;
  }
  return { outstandingPaise: outstanding, advancePaise: advance, buckets };
}
