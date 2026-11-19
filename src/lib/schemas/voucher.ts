import { z } from "zod";
import { optionalString, uuid, toResult, type ValidationResult } from "./common";

export const ENTRY_VOUCHER_TYPES = ["receipt", "payment", "journal", "contra"] as const;
export const ITEM_VOUCHER_TYPES = [
  "sales",
  "purchase",
  "credit_note",
  "debit_note",
  "sales_order",
  "delivery_note",
  "quotation",
] as const;
/** Quantity-only inventory documents (no party, no GL postings). */
export const STOCK_VOUCHER_TYPES = ["physical_stock"] as const;
export const ALL_VOUCHER_TYPES = [...ENTRY_VOUCHER_TYPES, ...ITEM_VOUCHER_TYPES, ...STOCK_VOUCHER_TYPES] as const;

/** Largest money amount accepted (paise). Same cap as entry lines. */
export const MAX_PAISE = 1_000_000_000_000;

/**
 * True only for a real calendar date. Date.parse() rolls 2026-02-31 over to 3 March,
 * so the year, month and day are checked against the month's real length instead.
 */
export function isRealCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const probe = new Date(0);
  probe.setUTCFullYear(y, mo, 0); // day 0 of month mo = last day of month mo
  return d <= probe.getUTCDate();
}

export const voucherDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isRealCalendarDate, "Not a real calendar date")
  .refine((s) => {
    const t = new Date(s).getTime();
    return t <= Date.now() + 2 * 24 * 60 * 60 * 1000;
  }, "Date cannot be in the future");

export const voucherEntrySchema = z
  .object({
    ledger_id: uuid,
    debit_paise: z.number().int().min(0).max(1_000_000_000_000),
    credit_paise: z.number().int().min(0).max(1_000_000_000_000),
    narration: optionalString(500).nullable().optional(),
    line_no: z.number().int().positive(),
  })
  .refine(
    (e) => (e.debit_paise > 0) !== (e.credit_paise > 0),
    "Each line must be either Debit or Credit (not both, not neither)",
  );

export const voucherItemSchema = z.object({
  item_id: uuid,
  line_no: z.number().int().positive(),
  description: optionalString(500).nullable().optional(),
  qty: z.number().positive("Qty must be > 0"),
  rate_paise: z.number().int().min(0).max(MAX_PAISE),
  discount_paise: z.number().int().min(0).max(MAX_PAISE),
  amount_paise: z.number().int().min(0).max(MAX_PAISE),
  taxable_paise: z.number().int().min(0).max(MAX_PAISE),
  gst_rate: z.number().min(0).max(100),
  cgst_paise: z.number().int().min(0).max(MAX_PAISE),
  sgst_paise: z.number().int().min(0).max(MAX_PAISE),
  igst_paise: z.number().int().min(0).max(MAX_PAISE),
});

export const voucherHeaderSchema = z.object({
  company_id: uuid,
  voucher_type: z.enum(ALL_VOUCHER_TYPES),
  voucher_date: voucherDateSchema,
  party_ledger_id: uuid.nullable().optional(),
  reference_no: optionalString(60).nullable().optional(),
  narration: optionalString(1000).nullable().optional(),
});

export const entryVoucherSchema = voucherHeaderSchema
  .extend({
    voucher_type: z.enum(ENTRY_VOUCHER_TYPES),
    total_paise: z.number().int().min(0),
    entries: z.array(voucherEntrySchema).min(2, "At least 2 ledger lines required"),
  })
  .superRefine((v, ctx) => {
    const dr = v.entries.reduce((s, e) => s + e.debit_paise, 0);
    const cr = v.entries.reduce((s, e) => s + e.credit_paise, 0);
    if (dr !== cr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries"],
        message: `Debit (${dr}) and Credit (${cr}) totals must match`,
      });
    }
    const ids = v.entries.map((e) => e.ledger_id);
    if (new Set(ids).size < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries"],
        message: "Use at least two distinct ledgers",
      });
    }
  });

export const itemVoucherSchema = voucherHeaderSchema
  .extend({
    voucher_type: z.enum(ITEM_VOUCHER_TYPES),
    is_interstate: z.boolean(),
    place_of_supply_code: optionalString(2).nullable().optional(),
    subtotal_paise: z.number().int().min(0).max(MAX_PAISE),
    cgst_paise: z.number().int().min(0).max(MAX_PAISE),
    sgst_paise: z.number().int().min(0).max(MAX_PAISE),
    igst_paise: z.number().int().min(0).max(MAX_PAISE),
    round_off_paise: z.number().int().min(-MAX_PAISE).max(MAX_PAISE),
    total_paise: z.number().int().min(0).max(MAX_PAISE),
    items: z.array(voucherItemSchema).min(1, "Add at least one item line"),
  })
  .superRefine((v, ctx) => {
    if (v.party_ledger_id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["party_ledger_id"],
        message: "Select a party",
      });
    }
    const sub = v.items.reduce((s, i) => s + i.taxable_paise, 0);
    if (Math.abs(sub - v.subtotal_paise) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subtotal_paise"],
        message: `Subtotal mismatch: expected ${sub}, got ${v.subtotal_paise}`,
      });
    }
    // Header tax must equal the item tax, with the same one-paisa tolerance the database uses.
    // Header total must equal subtotal + taxes + round-off exactly.
    // These mirror enforce_item_header_totals (migration 2026-06-18) so bad vouchers
    // are refused here with a message, before they reach the database.
    const sumC = v.items.reduce((s, i) => s + i.cgst_paise, 0);
    const sumS = v.items.reduce((s, i) => s + i.sgst_paise, 0);
    const sumI = v.items.reduce((s, i) => s + i.igst_paise, 0);
    if (Math.abs(sumC - v.cgst_paise) > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cgst_paise"], message: `CGST mismatch: items ${sumC}, header ${v.cgst_paise}` });
    }
    if (Math.abs(sumS - v.sgst_paise) > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sgst_paise"], message: `SGST mismatch: items ${sumS}, header ${v.sgst_paise}` });
    }
    if (Math.abs(sumI - v.igst_paise) > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["igst_paise"], message: `IGST mismatch: items ${sumI}, header ${v.igst_paise}` });
    }
    const expectedTotal = v.subtotal_paise + v.cgst_paise + v.sgst_paise + v.igst_paise + v.round_off_paise;
    if (expectedTotal !== v.total_paise) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total_paise"],
        message: `Total mismatch: subtotal + taxes + round-off is ${expectedTotal}, total is ${v.total_paise}`,
      });
    }
    // Each line: CGST equals SGST, and IGST appears only on its own (not with CGST/SGST).
    v.items.forEach((line, idx) => {
      if (line.cgst_paise !== line.sgst_paise) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", idx, "sgst_paise"], message: "Line CGST must equal SGST" });
      }
      if (line.igst_paise > 0 && (line.cgst_paise > 0 || line.sgst_paise > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", idx, "igst_paise"], message: "A line uses IGST or CGST+SGST, not both" });
      }
    });
    if (v.is_interstate) {
      if (v.cgst_paise !== 0 || v.sgst_paise !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["igst_paise"],
          message: "Interstate vouchers must use IGST only",
        });
      }
    } else if (v.igst_paise !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["igst_paise"],
        message: "Intra-state vouchers must use CGST+SGST only",
      });
    }
  });

export type EntryVoucherInput = z.infer<typeof entryVoucherSchema>;
export type ItemVoucherInput = z.infer<typeof itemVoucherSchema>;

export function validateEntryVoucher(input: unknown): ValidationResult<EntryVoucherInput> {
  return toResult(entryVoucherSchema.safeParse(input));
}
export function validateItemVoucher(input: unknown): ValidationResult<ItemVoucherInput> {
  return toResult(itemVoucherSchema.safeParse(input));
}