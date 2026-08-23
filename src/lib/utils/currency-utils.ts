
/**
 * Authoritative currency and monetary utilities for the Smart Accountant.
 * ALL monetary values must remain integer paise.
 * Never introduce floating-point monetary calculations.
 */

/**
 * Format integer paise into a standard INR display string (₹0.00).
 */
export function formatINR(paise: number): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const cents = absPaise % 100;
  const formattedCents = cents.toString().padStart(2, "0");
  
  // Basic INR comma grouping (optional, but professional)
  const rupeeStr = rupees.toString();
  let lastThree = rupeeStr.substring(rupeeStr.length - 3);
  const otherNumbers = rupeeStr.substring(0, rupeeStr.length - 3);
  if (otherNumbers !== "") {
    lastThree = "," + lastThree;
  }
  const formattedRupees = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  
  return `${isNegative ? "-" : ""}₹${formattedRupees}.${formattedCents}`;
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
 * Round a value to the nearest rupee (100 paise).
 */
export function roundToNearestRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}
