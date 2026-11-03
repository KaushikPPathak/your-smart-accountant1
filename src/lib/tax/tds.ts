/**
 * TDS on a payment voucher (sections 194C, 194J, 194Q).
 *
 * The party is debited the gross amount. The bank is credited the gross less
 * the TDS, and the TDS payable ledger is credited with the TDS. The debits and
 * credits then always balance: gross = (gross - TDS) + TDS.
 */

export interface TdsSection {
  code: "194C" | "194J" | "194Q";
  label: string;
  /** Default rate in percent. The user can change it on the voucher. */
  defaultRatePercent: number;
  /** Short note shown next to the rate. */
  note: string;
}

export const TDS_SECTIONS: TdsSection[] = [
  { code: "194C", label: "194C — Contractors", defaultRatePercent: 2, note: "1% for individuals/HUF, 2% for others" },
  { code: "194J", label: "194J — Professional / technical fees", defaultRatePercent: 10, note: "2% for some technical services" },
  { code: "194Q", label: "194Q — Purchase of goods", defaultRatePercent: 0.1, note: "On purchases above ₹50 lakh in a year" },
];

export function tdsSection(code: string): TdsSection | undefined {
  return TDS_SECTIONS.find((s) => s.code === code);
}

/** TDS in paise, rounded to the nearest paisa. Returns 0 for a zero or invalid rate. */
export function tdsAmountPaise(grossPaise: number, ratePercent: number): number {
  if (!Number.isFinite(grossPaise) || !Number.isFinite(ratePercent)) return 0;
  if (grossPaise <= 0 || ratePercent <= 0) return 0;
  return Math.round((grossPaise * ratePercent) / 100);
}

export interface TdsSplit {
  /** Credit to the bank / cash ledger: gross less TDS. */
  bankCreditPaise: number;
  /** Credit to the TDS payable ledger. */
  tdsPaise: number;
}

/** Splits a payment's gross amount into the bank credit and the TDS credit. */
export function splitTds(grossPaise: number, ratePercent: number): TdsSplit {
  const tdsPaise = Math.min(tdsAmountPaise(grossPaise, ratePercent), grossPaise);
  return { bankCreditPaise: grossPaise - tdsPaise, tdsPaise };
}

/** Narration written on the TDS line, e.g. "TDS 194J @ 10%". */
export function tdsNarration(code: string, ratePercent: number): string {
  return `TDS ${code} @ ${ratePercent}%`;
}

/** Friendly error for an unusable rate, or null when the rate is fine. */
export function tdsRateError(ratePercent: number): string | null {
  if (!Number.isFinite(ratePercent)) return "Enter a TDS rate as a number.";
  if (ratePercent <= 0) return "TDS rate must be above 0.";
  if (ratePercent > 30) return "TDS rate looks too high. Check the rate for this section.";
  return null;
}
