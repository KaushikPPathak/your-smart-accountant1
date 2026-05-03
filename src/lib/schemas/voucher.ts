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
export const ALL_VOUCHER_TYPES = [...ENTRY_VOUCHER_TYPES, ...ITEM_VOUCHER_TYPES] as const;

export const voucherDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date")
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
  rate_paise: z.number().int().min(0),
  discount_paise: z.number().int().min(0),
  amount_paise: z.number().int().min(0),
  taxable_paise: z.number().int().min(0),
  gst_rate: z.number().min(0).max(100),
  cgst_paise: z.number().int().min(0),
  sgst_paise: z.number().int().min(0),
  igst_paise: z.number().int().min(0),
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
    subtotal_paise: z.number().int().min(0),
    cgst_paise: z.number().int().min(0),
    sgst_paise: z.number().int().min(0),
    igst_paise: z.number().int().min(0),
    round_off_paise: z.number().int(),
    total_paise: z.number().int().min(0),
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