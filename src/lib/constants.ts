// Shared lookup tables for Indian states and ledger/item helpers

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman & Diu" },
  { code: "26", name: "Dadra & Nagar Haveli" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (Old)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

export const LEDGER_TYPES = [
  { value: "sundry_debtor", label: "Sundry Debtor (Customer)" },
  { value: "sundry_creditor", label: "Sundry Creditor (Supplier)" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "expense_direct", label: "Direct Expense" },
  { value: "expense_indirect", label: "Indirect Expense" },
  { value: "income_direct", label: "Direct Income (Sales)" },
  { value: "income_indirect", label: "Indirect Income" },
  { value: "fixed_asset", label: "Fixed Asset" },
  { value: "current_asset", label: "Current Asset" },
  { value: "current_liability", label: "Current Liability" },
  { value: "loan_liability", label: "Loan / Liability" },
  { value: "capital", label: "Capital Account" },
  { value: "duties_taxes", label: "Duties & Taxes" },
  { value: "stock_in_hand", label: "Stock in Hand" },
] as const;

export type LedgerTypeValue = (typeof LEDGER_TYPES)[number]["value"];

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28] as const;

export const UNITS = [
  "NOS",
  "PCS",
  "KGS",
  "GMS",
  "LTR",
  "MTR",
  "BOX",
  "PKT",
  "BAG",
  "BTL",
  "DOZ",
  "ROL",
  "SET",
  "SQM",
  "SQF",
  "TON",
  "UNT",
  "NA",
] as const;

/** SAC codes (services) all start with "99" — no physical unit applies. */
export function isServiceHsn(code: string | null | undefined): boolean {
  const c = (code || "").trim();
  return c.length >= 4 && c.startsWith("99");
}

export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
