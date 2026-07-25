// Presumptive-taxation calculator for sections 44AD and 44ADA.
//
// Section 44AD (small business):
//   • Eligible: resident individuals, HUFs and partnership firms (not LLP,
//     not company). Gross turnover ≤ ₹2 crore, extended to ₹3 crore if
//     ≥ 95% of receipts are through banking / digital channels.
//   • Deemed profit: 8% of gross turnover for cash receipts; 6% for digital.
//
// Section 44ADA (professionals):
//   • Eligible: individuals / partnership firms in "specified professions"
//     (legal, medical, engineering, architectural, accountancy, technical
//     consultancy, interior decoration, notified professions).
//   • Gross receipts ≤ ₹50 lakh, extended to ₹75 lakh if ≥ 95% receipts
//     are digital.
//   • Deemed profit: 50% of gross receipts.

export type PresumptiveScheme = "none" | "44ad" | "44ada";
export type PresumptiveMode = "digital" | "cash" | "professional";

export interface PresumptiveInput {
  scheme: PresumptiveScheme;
  mode?: PresumptiveMode | null;
  grossReceiptsPaise: number;
  digitalReceiptsPaise?: number;   // subset of gross — used to check the 95% digital-rule extension
}

export interface PresumptiveResult {
  scheme: PresumptiveScheme;
  applicable: boolean;
  eligibleThresholdPaise: number;
  effectiveRatePct: number;          // e.g. 6, 8, 50
  deemedProfitPaise: number;
  thresholdBreached: boolean;
  digitalSharePct: number;
  usesExtendedLimit: boolean;        // true when the ₹3 Cr / ₹75 L cap applied
  message: string;
}

const CRORE_PAISE = 1_000_000_000;
const LAKH_PAISE  = 10_000_000;

const BASE_44AD_LIMIT = 2 * CRORE_PAISE;
const EXT_44AD_LIMIT  = 3 * CRORE_PAISE;
const BASE_44ADA_LIMIT = 50 * LAKH_PAISE;
const EXT_44ADA_LIMIT  = 75 * LAKH_PAISE;

export function computePresumptive(input: PresumptiveInput): PresumptiveResult {
  const gross = Math.max(0, input.grossReceiptsPaise || 0);
  const digital = Math.max(0, Math.min(gross, input.digitalReceiptsPaise ?? 0));
  const digitalShare = gross === 0 ? 0 : (digital / gross) * 100;
  const digitalQualifies = digitalShare >= 95;

  if (input.scheme === "none") {
    return {
      scheme: "none", applicable: false,
      eligibleThresholdPaise: 0, effectiveRatePct: 0,
      deemedProfitPaise: 0, thresholdBreached: false,
      digitalSharePct: digitalShare, usesExtendedLimit: false,
      message: "Presumptive taxation not opted.",
    };
  }

  if (input.scheme === "44ad") {
    const threshold = digitalQualifies ? EXT_44AD_LIMIT : BASE_44AD_LIMIT;
    const breached = gross > threshold;
    const mode = input.mode ?? "cash";
    const rate = mode === "digital" ? 6 : 8;
    const profit = Math.round(gross * rate / 100);
    return {
      scheme: "44ad", applicable: !breached,
      eligibleThresholdPaise: threshold,
      effectiveRatePct: rate,
      deemedProfitPaise: profit,
      thresholdBreached: breached,
      digitalSharePct: digitalShare,
      usesExtendedLimit: digitalQualifies,
      message: breached
        ? `Gross turnover exceeds the §44AD limit (₹${threshold / CRORE_PAISE} Cr) — regular assessment / tax audit required.`
        : `Deemed profit @ ${rate}% of gross turnover under §44AD.`,
    };
  }

  // 44ADA
  const threshold = digitalQualifies ? EXT_44ADA_LIMIT : BASE_44ADA_LIMIT;
  const breached = gross > threshold;
  const profit = Math.round(gross * 50 / 100);
  return {
    scheme: "44ada", applicable: !breached,
    eligibleThresholdPaise: threshold,
    effectiveRatePct: 50,
    deemedProfitPaise: profit,
    thresholdBreached: breached,
    digitalSharePct: digitalShare,
    usesExtendedLimit: digitalQualifies,
    message: breached
      ? `Gross receipts exceed the §44ADA limit (₹${threshold / LAKH_PAISE} L) — tax audit under §44AB may apply.`
      : "Deemed profit @ 50% of gross receipts under §44ADA (specified professions).",
  };
}
