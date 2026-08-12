import { z } from "zod";

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const CIN_REGEX = /^[LU]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const optionalString = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const optionalGstin = z
  .string()
  .trim()
  .max(15)
  .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN")
  .optional()
  .or(z.literal(""));

export const optionalEmail = z
  .string()
  .trim()
  .max(255)
  .email("Invalid email")
  .optional()
  .or(z.literal(""));

// Local-first app: IDs are opaque handles that may come from IndexedDB,
// imports, merges, or older backups (not always canonical UUIDs). Accept
// any non-empty trimmed string — strict UUID checking here blocks legitimate
// restored/imported data entry with a confusing "Invalid id" toast.
export const uuid = z.string().trim().min(1, "Invalid id");

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export function toResult<T>(parsed: z.SafeParseReturnType<unknown, T>): ValidationResult<T> {
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const fieldErrors: Record<string, string> = {};
  for (const i of parsed.error.issues) {
    const key = i.path.join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = i.message;
  }
  return { ok: false, message: issue?.message ?? "Validation failed", fieldErrors };
}