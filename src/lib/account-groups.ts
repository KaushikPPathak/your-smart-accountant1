// Schedule III / Income-Tax India style account groups.
// Every ledger belongs to a group, and every group rolls up into a single
// section of the Balance Sheet, Trading A/c or Profit & Loss A/c.

import type { LedgerTypeValue } from "@/lib/constants";

export type AccountSection =
  | "BS_LIAB"   // Balance Sheet — Liabilities (Sources of Funds)
  | "BS_ASSET"  // Balance Sheet — Assets (Application of Funds)
  | "TRADING"   // Trading A/c (direct income / direct expense / stock)
  | "PL";       // Profit & Loss A/c (indirect income / indirect expense)

export type AccountSide = "Dr" | "Cr";

export interface AccountGroup {
  code: string;
  label: string;
  section: AccountSection;
  side: AccountSide;          // natural side of the group
  order: number;              // display order within section
  /** Acceptable ledger.type values for this group. First entry = default. */
  ledgerTypes: LedgerTypeValue[];
  /** Regex hints used by OCR auto-mapping (matched against account name). */
  hints?: RegExp[];
}

export const ACCOUNT_GROUPS: AccountGroup[] = [
  // ───────── SOURCES OF FUNDS — Liabilities (Cr) ─────────
  {
    code: "CAPITAL_ACCOUNT", label: "Capital Account",
    section: "BS_LIAB", side: "Cr", order: 10,
    ledgerTypes: ["capital"],
    hints: [/\bcapital\b/i, /\bowner'?s?\s+equity\b/i, /\bproprietor\b/i, /\bpartner'?s?\s+capital\b/i],
  },
  {
    code: "RESERVES_AND_SURPLUS", label: "Reserves & Surplus",
    section: "BS_LIAB", side: "Cr", order: 20,
    ledgerTypes: ["capital"],
    hints: [/\breserve(s)?\b/i, /\bsurplus\b/i, /\bretained\s+earnings\b/i, /\bgeneral\s+reserve\b/i],
  },
  {
    code: "SECURED_LOANS", label: "Secured Loans",
    section: "BS_LIAB", side: "Cr", order: 30,
    ledgerTypes: ["loan_liability"],
    hints: [/\bsecured\s+loan/i, /\bterm\s+loan/i, /\bcc\s*a\/c\b/i, /\bcash\s+credit\b/i, /\bod\s*a\/c\b/i, /\bover\s*draft\b/i],
  },
  {
    code: "UNSECURED_LOANS", label: "Unsecured Loans",
    section: "BS_LIAB", side: "Cr", order: 40,
    ledgerTypes: ["loan_liability"],
    hints: [/\bunsecured\s+loan/i, /\bloan\s+from\b/i, /\bdirector'?s?\s+loan\b/i, /\bborrow/i],
  },
  {
    code: "SUNDRY_CREDITORS", label: "Sundry Creditors",
    section: "BS_LIAB", side: "Cr", order: 50,
    ledgerTypes: ["sundry_creditor"],
    hints: [/\bcreditor/i, /\bpayable\b/i, /\bsupplier/i, /\bvendor/i, /\btrade\s+payable/i],
  },
  {
    code: "DUTIES_AND_TAXES", label: "Duties & Taxes",
    section: "BS_LIAB", side: "Cr", order: 60,
    ledgerTypes: ["duties_taxes"],
    hints: [/\bgst\b/i, /\bcgst\b/i, /\bsgst\b/i, /\bigst\b/i, /\btds\b/i, /\btcs\b/i, /\bduties?\s*&?\s*taxes?\b/i, /\bvat\b/i],
  },
  {
    code: "PROVISIONS", label: "Provisions",
    section: "BS_LIAB", side: "Cr", order: 70,
    ledgerTypes: ["current_liability"],
    hints: [/\bprovision\b/i, /\bprovision\s+for\b/i],
  },
  {
    code: "CURRENT_LIABILITIES", label: "Current Liabilities",
    section: "BS_LIAB", side: "Cr", order: 80,
    ledgerTypes: ["current_liability"],
    hints: [/\bcurrent\s+liabilit/i, /\boutstanding\s+expense/i, /\bexpense.*payable\b/i, /\bsalary\s+payable\b/i, /\brent\s+payable\b/i],
  },

  // ───────── APPLICATION OF FUNDS — Assets (Dr) ─────────
  {
    code: "FIXED_ASSETS", label: "Fixed Assets",
    section: "BS_ASSET", side: "Dr", order: 110,
    ledgerTypes: ["fixed_asset"],
    hints: [/\bfixed\s+asset/i, /\bbuilding/i, /\bmachinery\b/i, /\bplant\b/i, /\bfurniture\b/i, /\bvehicle/i, /\bequipment\b/i, /\bcomputer\b/i, /\bmobile\s+phone\b/i, /\bland\b/i, /\bpremises\b/i, /\bresidential\s+premises\b/i, /\boffice\s+premises\b/i, /\bfactory\s+premises\b/i, /\bgodown\b/i, /\bshop\b/i, /\btools?\b/i, /\bfittings?\b/i],
  },
  {
    code: "INVESTMENTS", label: "Investments",
    section: "BS_ASSET", side: "Dr", order: 120,
    ledgerTypes: ["current_asset"],
    hints: [/\binvestment/i, /\bshares?\b/i, /\bmutual\s+fund/i, /\bfd\b/i, /\bfixed\s+deposit/i, /\bdebenture/i, /\bbonds?\b/i],
  },
  {
    code: "STOCK_IN_HAND", label: "Stock-in-Hand",
    section: "BS_ASSET", side: "Dr", order: 130,
    ledgerTypes: ["stock_in_hand"],
    hints: [/\bstock[\s-]*in[\s-]*hand\b/i, /\binventory\b/i, /\bclosing\s+stock\b/i, /\bopening\s+stock\b/i],
  },
  {
    code: "SUNDRY_DEBTORS", label: "Sundry Debtors",
    section: "BS_ASSET", side: "Dr", order: 140,
    ledgerTypes: ["sundry_debtor"],
    hints: [/\bdebtor/i, /\breceivable\b/i, /\bcustomer\b/i, /\btrade\s+receivable/i],
  },
  {
    code: "CASH_IN_HAND", label: "Cash-in-Hand",
    section: "BS_ASSET", side: "Dr", order: 150,
    ledgerTypes: ["cash"],
    hints: [/\bcash\b/i, /\bpetty\s+cash\b/i],
  },
  {
    code: "BANK_ACCOUNTS", label: "Bank Accounts",
    section: "BS_ASSET", side: "Dr", order: 160,
    ledgerTypes: ["bank"],
    hints: [/\bbank\b/i, /\bhdfc\b/i, /\bicici\b/i, /\bsbi\b/i, /\baxis\b/i, /\bkotak\b/i, /\bbob\b/i, /\bbank\s+of\s+baroda\b/i, /\bsutex\b/i, /\byes\s+bank\b/i, /\bidfc\b/i, /\bcanara\b/i],
  },
  {
    code: "LOANS_AND_ADVANCES_ASSET", label: "Loans & Advances (Asset)",
    section: "BS_ASSET", side: "Dr", order: 170,
    ledgerTypes: ["current_asset"],
    hints: [/\bloans?\s*&?\s*advances?\b/i, /\badvance\s+to\b/i, /\binterest\s+receivable\b/i, /\btds\s+receivable\b/i, /\btds\s+\d/i],
  },
  {
    code: "CURRENT_ASSETS", label: "Current Assets",
    section: "BS_ASSET", side: "Dr", order: 180,
    ledgerTypes: ["current_asset"],
    hints: [/\bcurrent\s+asset/i, /\bprepaid\b/i, /\bdeposit\b/i],
  },
  {
    code: "MISC_EXPENSES_ASSET", label: "Misc. Expenses (Asset)",
    section: "BS_ASSET", side: "Dr", order: 190,
    ledgerTypes: ["current_asset"],
    hints: [/\bmisc(ellaneous)?\s+expense/i, /\bpreliminary\s+expense/i, /\bloss\s+to\s+be\s+adjusted\b/i, /\bprofit\s*\/\s*loss\s+a\/c\b/i],
  },

  // ───────── TRADING A/c ─────────
  {
    code: "SALES_ACCOUNTS", label: "Sales Accounts",
    section: "TRADING", side: "Cr", order: 210,
    ledgerTypes: ["income_direct"],
    hints: [/\bsales?\b/i, /\brevenue\b/i, /\bturnover\b/i],
  },
  {
    code: "PURCHASE_ACCOUNTS", label: "Purchase Accounts",
    section: "TRADING", side: "Dr", order: 220,
    ledgerTypes: ["expense_direct"],
    hints: [/\bpurchase/i, /\bcost\s+of\s+goods\b/i, /\bcogs\b/i],
  },
  {
    code: "DIRECT_EXPENSES", label: "Direct Expenses",
    section: "TRADING", side: "Dr", order: 230,
    ledgerTypes: ["expense_direct"],
    hints: [/\bdirect\s+expense/i, /\bcarriage\s+inward/i, /\bfreight\s+inward/i, /\bwages\b/i, /\bmanufacturing\b/i, /\bfactory\b/i],
  },
  {
    code: "DIRECT_INCOMES", label: "Direct Incomes",
    section: "TRADING", side: "Cr", order: 240,
    ledgerTypes: ["income_direct"],
    hints: [/\bdirect\s+income/i, /\bservice\s+income\b/i],
  },

  // ───────── PROFIT & LOSS A/c ─────────
  {
    code: "INDIRECT_INCOMES", label: "Indirect Incomes",
    section: "PL", side: "Cr", order: 310,
    ledgerTypes: ["income_indirect"],
    hints: [/\bindirect\s+income/i, /\binterest\s+received\b/i, /\bcommission\s+received\b/i, /\bdiscount\s+received\b/i, /\brent\s+received\b/i, /\bother\s+income\b/i],
  },
  {
    code: "INDIRECT_EXPENSES", label: "Indirect Expenses",
    section: "PL", side: "Dr", order: 320,
    ledgerTypes: ["expense_indirect"],
    hints: [/\bindirect\s+expense/i, /\bsalary\b/i, /\brent\s+paid\b/i, /\belectricity\b/i, /\binternet\b/i, /\binterest\s+paid\b/i, /\bbank\s+charge/i, /\boffice\s+expense/i, /\badmin/i, /\btravel/i, /\bprinting\b/i, /\bstationery\b/i, /\btelephone\b/i, /\bdepreciation\b/i, /\baudit\s+fee/i, /\bprofessional\s+fee/i, /\blegal\s+expense/i],
  },
];

export const GROUP_BY_CODE: Record<string, AccountGroup> =
  Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g.code, g]));

export const GROUPS_BY_SECTION: Record<AccountSection, AccountGroup[]> = {
  BS_LIAB: ACCOUNT_GROUPS.filter((g) => g.section === "BS_LIAB").sort((a, b) => a.order - b.order),
  BS_ASSET: ACCOUNT_GROUPS.filter((g) => g.section === "BS_ASSET").sort((a, b) => a.order - b.order),
  TRADING: ACCOUNT_GROUPS.filter((g) => g.section === "TRADING").sort((a, b) => a.order - b.order),
  PL: ACCOUNT_GROUPS.filter((g) => g.section === "PL").sort((a, b) => a.order - b.order),
};

/** Default group code derived from a ledger.type (used as fallback). */
export function defaultGroupCodeForType(type: LedgerTypeValue): string {
  const map: Record<LedgerTypeValue, string> = {
    capital: "CAPITAL_ACCOUNT",
    loan_liability: "UNSECURED_LOANS",
    sundry_creditor: "SUNDRY_CREDITORS",
    duties_taxes: "DUTIES_AND_TAXES",
    current_liability: "CURRENT_LIABILITIES",
    fixed_asset: "FIXED_ASSETS",
    stock_in_hand: "STOCK_IN_HAND",
    sundry_debtor: "SUNDRY_DEBTORS",
    cash: "CASH_IN_HAND",
    bank: "BANK_ACCOUNTS",
    current_asset: "CURRENT_ASSETS",
    income_direct: "SALES_ACCOUNTS",
    income_indirect: "INDIRECT_INCOMES",
    expense_direct: "PURCHASE_ACCOUNTS",
    expense_indirect: "INDIRECT_EXPENSES",
  };
  return map[type];
}

/** Patterns that are strong enough to override an explicit section heading.
 *  Used when an OCR'd PDF mistakenly lists, e.g., "HDFC Bank Loan A/c" under
 *  "Capital Account" — a name with a strong identifier (HDFC) takes priority.
 *  Anything not in this list defers to the section heading. */
const STRONG_OVERRIDE_HINTS: { rx: RegExp; code: string }[] = [
  { rx: /\b(hdfc|icici|sbi|axis|kotak|yes\s*bank|idfc|canara|bob|bank\s+of\s+baroda|sutex)\b/i, code: "BANK_ACCOUNTS" },
  { rx: /\b(cgst|sgst|igst|tds|tcs|gst\s+payable)\b/i, code: "DUTIES_AND_TAXES" },
  { rx: /\b(petty\s+cash|cash\s+a\/c|cash\s+in\s+hand)\b/i, code: "CASH_IN_HAND" },
];
/** Generic catch-all section codes that LOSE to a strong override. */
const GENERIC_HINT_CODES = new Set([
  "CURRENT_ASSETS",
  "CURRENT_LIABILITIES",
  "MISC_EXPENSES_ASSET",
]);

/** Best-guess group code for an account name + Dr/Cr side, using regex hints. */
export function guessGroupCode(name: string, side: AccountSide, sectionHint?: string): string {
  const n = name.trim();
  if (!n) {
    if (sectionHint && GROUP_BY_CODE[sectionHint]) return sectionHint;
    return side === "Dr" ? "CURRENT_ASSETS" : "CURRENT_LIABILITIES";
  }

  // Section heading is normally the source of truth. We only override it when:
  //   (a) the section is a generic catch-all (CURRENT_ASSETS / CURRENT_LIABILITIES), AND
  //   (b) the row name contains a STRONG identifier (HDFC, CGST, etc.).
  // This prevents the previous bug where any same-side regex hit (e.g. the
  // word "bank" in a person's name) silently overrode an explicit section
  // heading like "Capital Account".
  if (sectionHint && GROUP_BY_CODE[sectionHint]) {
    const hintGroup = GROUP_BY_CODE[sectionHint];
    // If the row's actual side disagrees with the section's natural side
    // (typically because the source had a negative amount that flipped the
    // side), the section heading is the wrong roll-up — fall through to
    // name-based matching so e.g. "Machinery" listed under "Unsecured Loans"
    // lands in Fixed Assets, not as a negative loan.
    if (hintGroup.side === side) {
      if (GENERIC_HINT_CODES.has(sectionHint)) {
        const strong = STRONG_OVERRIDE_HINTS.find((h) => h.rx.test(n));
        if (strong && GROUP_BY_CODE[strong.code]?.side === side) return strong.code;
      }
      return sectionHint;
    }
  }

  // Try to match hints, preferring groups whose natural side matches the row's side.
  const candidates = ACCOUNT_GROUPS.filter((g) => g.side === side);
  for (const g of candidates) {
    if (g.hints?.some((rx) => rx.test(n))) return g.code;
  }
  // Fall back to any-side match
  for (const g of ACCOUNT_GROUPS) {
    if (g.hints?.some((rx) => rx.test(n))) return g.code;
  }
  // Last-resort by side
  return side === "Dr" ? "CURRENT_ASSETS" : "CURRENT_LIABILITIES";
}

/** Default ledger.type for a group code (so we can persist). */
export function defaultLedgerTypeForGroup(code: string): LedgerTypeValue {
  return GROUP_BY_CODE[code]?.ledgerTypes[0] ?? "current_asset";
}

export function groupLabel(code: string | null | undefined): string {
  if (!code) return "Unclassified";
  return GROUP_BY_CODE[code]?.label ?? code;
}
