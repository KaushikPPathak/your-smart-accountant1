// Money helpers — store as integer paise, display with the user's chosen symbol.
// Books are always kept in INR (paise). The currency switcher only swaps the
// displayed symbol — numbers and grouping are unchanged.
import { getCurrentCurrencySymbol } from "./currency";

export const rupeesToPaise = (rupees: number | string): number => {
  const n = typeof rupees === "string" ? parseFloat(rupees) : rupees;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

export const paiseToRupees = (paise: number): number => paise / 100;

/** Indian numbering: 12,34,567.89 — symbol comes from the global currency setting. */
export const formatINR = (paise: number, opts: { symbol?: boolean } = {}): string => {
  const { symbol = true } = opts;
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  const abs = Math.abs(rupees);
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol ? `${getCurrentCurrencySymbol()} ` : ""}${formatted}`;
};

const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n: number): string => {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
};

const threeDigits = (n: number): string => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? twoDigits(r) : "");
};

/** Indian Rupees in Words (e.g. "Rupees One Lakh Twenty Three Thousand Only") */
export const amountInWords = (paise: number): string => {
  const rupees = Math.floor(paise / 100);
  const paiseRem = paise % 100;
  if (rupees === 0 && paiseRem === 0) return "Rupees Zero Only";

  let n = rupees;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (n) parts.push(threeDigits(n));

  let result = "Rupees " + (parts.join(" ").trim() || "Zero");
  if (paiseRem) result += " and " + twoDigits(paiseRem) + " Paise";
  result += " Only";
  return result;
};
