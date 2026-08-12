// ICAI Non-Corporate Entity (NCE) level classification.
//
// Per the ICAI framework for AS for NCEs (revised), an entity is Level 1
// (largest / most disclosures) when EITHER
//   • turnover in the preceding accounting year > ₹250 crore, or
//   • outstanding borrowings > ₹50 crore.
// Level 2 (medium) when turnover > ₹50 crore or borrowings > ₹10 crore.
// Level 3 (small — MSME-scale) when neither Level 1 nor Level 2 threshold is
// crossed. Level 4 (micro) is folded into Level 3 for this app's purposes
// since the disclosure delta is negligible for small-business bookkeeping.
//
// Pvt Ltd companies are explicitly outside the NCE framework — they follow
// Schedule III of the Companies Act. We flag them so callers can route those
// to the corporate reporting shape instead of the NCE shape.

import type { EntityStatus } from "./entity-status";

export type NceLevel = 1 | 2 | 3;

export interface ClassifyInput {
  entity: EntityStatus;
  turnoverPaise: number;
  borrowingsPaise: number;
}

export interface ClassifyResult {
  isCorporate: boolean;      // pvt_ltd — skip NCE, use Schedule III
  level: NceLevel;
  reason: string;
}

// Rupees → paise. ₹1 crore = 10,000,000 rupees = 1,000,000,000 paise.
const CRORE_PAISE = 1_000_000_000;
const L1_TURNOVER = 250 * CRORE_PAISE;
const L1_BORROW   = 50  * CRORE_PAISE;
const L2_TURNOVER = 50  * CRORE_PAISE;
const L2_BORROW   = 10  * CRORE_PAISE;

export function classifyNceLevel(input: ClassifyInput): ClassifyResult {
  if (input.entity === "pvt_ltd") {
    return {
      isCorporate: true,
      level: 1,
      reason: "Private Limited — Schedule III of the Companies Act applies (outside the NCE framework).",
    };
  }
  const t = Math.max(0, input.turnoverPaise || 0);
  const b = Math.max(0, input.borrowingsPaise || 0);

  if (t > L1_TURNOVER || b > L1_BORROW) {
    return {
      isCorporate: false,
      level: 1,
      reason: t > L1_TURNOVER
        ? "Turnover exceeds ₹250 crore — Level 1 disclosures apply."
        : "Borrowings exceed ₹50 crore — Level 1 disclosures apply.",
    };
  }
  if (t > L2_TURNOVER || b > L2_BORROW) {
    return {
      isCorporate: false,
      level: 2,
      reason: t > L2_TURNOVER
        ? "Turnover exceeds ₹50 crore — Level 2 disclosures apply."
        : "Borrowings exceed ₹10 crore — Level 2 disclosures apply.",
    };
  }
  return {
    isCorporate: false,
    level: 3,
    reason: "Turnover ≤ ₹50 crore and borrowings ≤ ₹10 crore — Level 3 (small entity) simplified reporting applies.",
  };
}

// Disclosure flags — which report sections must be shown for each level.
// Level 3 hides corporate-heavy items so proprietors and small firms don't
// see empty schedules they'll never fill in.
export interface NceDisclosureFlags {
  showCashFlow: boolean;
  showRelatedParty: boolean;
  showSegmentReport: boolean;
  showDeferredTax: boolean;
  showEmployeeBenefits: boolean;   // AS 15 detailed disclosures
  showScheduleIII: boolean;        // Companies-Act balance sheet layout
}

export function getNceDisclosureFlags(level: NceLevel, isCorporate: boolean): NceDisclosureFlags {
  if (isCorporate) {
    return {
      showCashFlow: true, showRelatedParty: true, showSegmentReport: true,
      showDeferredTax: true, showEmployeeBenefits: true, showScheduleIII: true,
    };
  }
  switch (level) {
    case 1: return {
      showCashFlow: true, showRelatedParty: true, showSegmentReport: true,
      showDeferredTax: true, showEmployeeBenefits: true, showScheduleIII: false,
    };
    case 2: return {
      showCashFlow: true, showRelatedParty: true, showSegmentReport: false,
      showDeferredTax: true, showEmployeeBenefits: false, showScheduleIII: false,
    };
    case 3:
    default: return {
      showCashFlow: false, showRelatedParty: false, showSegmentReport: false,
      showDeferredTax: false, showEmployeeBenefits: false, showScheduleIII: false,
    };
  }
}

export const NCE_LEVEL_LABEL: Record<NceLevel, string> = {
  1: "Level 1 (Large)",
  2: "Level 2 (Medium)",
  3: "Level 3 (Small / MSME)",
};
