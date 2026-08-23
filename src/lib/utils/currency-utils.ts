
/**
 * Authoritative currency and monetary utilities for the Smart Accountant.
 * ALL monetary values must remain integer paise.
 * Never introduce floating-point monetary calculations.
 */
import { getCurrentCurrencySymbol } from "@/lib/currency";

/**
 * Format integer paise into a standard INR display string (₹0.00).
 * Indian numbering: 12,34,567.89 — symbol comes from the global currency setting.
 */
export function formatINR(paise: number, opts: { symbol?: boolean } = {}): string {
  const { symbol = true } = opts;
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  const abs = Math.abs(rupees);
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol ? `${getCurrentCurrencySymbol()} ` : ""}${formatted}`;
}

/**
 * Format integer paise for plain text displays without the rupee symbol.
 */
export function formatPaise(paise: number): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const cents = absPaise % 100;
  return `${isNegative ? "-" : ""}${rupees}.${cents.toString().padStart(2, "0")}`;
}


/**
 * Convert a rupee string (e.g., "1,234.56" or "1234.5") into integer paise.
 * Hardened against floating point errors by using string split and integer math.
 */
export function parseToPaise(rupeeString: string | number): number {
  if (typeof rupeeString === "number") return Math.round(rupeeString * 100);
  if (!rupeeString) return 0;
  
  const cleanStr = rupeeString.toString().replace(/[^0-9.-]/g, "");
  if (!cleanStr || cleanStr === "." || cleanStr === "-") return 0;
  
  const parts = cleanStr.split(".");
  const rupees = parseInt(parts[0] || "0", 10);
  let cents = 0;
  
  if (parts.length > 1) {
    const centStr = parts[1].substring(0, 2).padEnd(2, "0");
    cents = parseInt(centStr, 10);
  }
  
  const total = Math.abs(rupees) * 100 + cents;
  return cleanStr.startsWith("-") ? -total : total;
}

/**
 * Calculate GST component from a taxable amount and rate.
 * Returns integer paise.
 */
export function calculateGST(taxablePaise: number, rate: number): number {
  // rate is percentage (e.g., 18 for 18%)
  // Calculation: (taxable * rate) / 100
  // To keep it in integer paise: round((taxablePaise * rate) / 100)
  return Math.round((taxablePaise * rate) / 100);
}

/**
 * Indian Rupees in Words (e.g. "Rupees One Lakh Twenty Three Thousand Only")
 */
export function amountInWords(paise: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
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
}

