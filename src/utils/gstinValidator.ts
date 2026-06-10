// Fully offline GSTIN validator.
// Structural regex + state-code check + official Mod-36 (Base-36) checksum.

import { isValidStateCode } from "./stateCodes";

export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Base-36 charset used by the GSTIN checksum algorithm.
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface GstinValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Mod-36 checksum used by GSTN.
 * - Take first 14 characters.
 * - Multiply each by alternating factors 1, 2, 1, 2 … (left to right).
 * - For each product, sum quotient + remainder against 36.
 * - Total sum mod 36 → checksum index = (36 - sum % 36) % 36.
 * - Compare against the 15th character.
 */
export function computeGstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const ch = first14.charAt(i);
    const v = CHARSET.indexOf(ch);
    if (v < 0) return ""; // invalid char
    const factor = i % 2 === 0 ? 1 : 2;
    const product = v * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checkIdx = (36 - (sum % 36)) % 36;
  return CHARSET.charAt(checkIdx);
}

export function validateGSTIN(gstin: string): GstinValidationResult {
  if (!gstin) return { valid: false, error: "GSTIN is required" };
  const g = gstin.trim().toUpperCase();
  if (g.length !== 15) return { valid: false, error: "GSTIN must be 15 characters" };
  if (!GSTIN_REGEX.test(g)) return { valid: false, error: "Invalid GSTIN format" };
  if (!isValidStateCode(g.slice(0, 2)))
    return { valid: false, error: "Invalid state code in GSTIN" };
  const expected = computeGstinChecksum(g.slice(0, 14));
  if (!expected) return { valid: false, error: "Invalid characters in GSTIN" };
  if (expected !== g.charAt(14))
    return { valid: false, error: "GSTIN checksum mismatch" };
  return { valid: true };
}
