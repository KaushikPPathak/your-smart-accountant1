
/**
 * Authoritative date utilities for the Smart Accountant.
 * Standardizes parsing, normalization, storage, and fiscal-year calculations.
 */

import { format, parseISO, isValid, startOfMonth, endOfMonth, isWithinInterval, startOfYear, endOfYear } from "date-fns";

/**
 * Format a Date object or ISO string to a storage-safe YYYY-MM-DD string.
 */
export function toISODate(date: Date | string): string {
  if (typeof date === "string") {
    const parsed = parseISO(date);
    return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : date;
  }
  return format(date, "yyyy-MM-dd");
}

/**
 * Format a Date or ISO string for display (DD-MM-YYYY).
 */
export function toDisplayDate(date: Date | string): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? parseISO(date) : date;
  return isValid(parsed) ? format(parsed, "dd-MM-yyyy") : String(date);
}

/**
 * Get the current fiscal year start (April 1st) for a given date.
 */
export function getFiscalYearStart(date: Date | string = new Date()): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  const year = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
  return new Date(year, 3, 1); // April 1st
}

/**
 * Get the current fiscal year end (March 31st) for a given date.
 */
export function getFiscalYearEnd(date: Date | string = new Date()): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  const year = d.getMonth() < 3 ? d.getFullYear() : d.getFullYear() + 1;
  return new Date(year, 2, 31); // March 31st
}

/**
 * Check if a date is within a given range (inclusive).
 */
export function isDateInRange(date: Date | string, start: Date | string, end: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  const s = typeof start === "string" ? parseISO(start) : start;
  const e = typeof end === "string" ? parseISO(end) : end;
  
  if (!isValid(d) || !isValid(s) || !isValid(e)) return false;
  
  return isWithinInterval(d, { start: s, end: e });
}

/**
 * Fiscal year label (e.g., "2024-25")
 */
export function getFiscalYearLabel(date: Date | string = new Date()): string {
  const start = getFiscalYearStart(date);
  const startYear = start.getFullYear();
  const endYear = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYear}`;
}
