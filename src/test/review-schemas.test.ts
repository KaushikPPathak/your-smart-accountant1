// Regression tests for the zod 3 -> 4 upgrade (review 2026-10-27): validation messages and error shape.
import { describe, expect, it } from "vitest";
import { toResult } from "@/lib/schemas/common";
import { ledgerFormSchema } from "@/lib/schemas/ledger";
import { voucherDateSchema, voucherEntrySchema } from "@/lib/schemas/voucher";

const LEDGER_ID = "11111111-1111-4111-8111-111111111111";

describe("review 2026-10-27: zod 4 validation", () => {
  it("accepts a valid debit line and rejects a line with both sides", () => {
    expect(toResult(voucherEntrySchema.safeParse({ ledger_id: LEDGER_ID, debit_paise: 100, credit_paise: 0, line_no: 1 })).ok).toBe(true);
    const bad = toResult(voucherEntrySchema.safeParse({ ledger_id: LEDGER_ID, debit_paise: 100, credit_paise: 100, line_no: 1 }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/either Debit or Credit/);
  });

  it("reports field errors keyed by field path", () => {
    const r = toResult(ledgerFormSchema.safeParse({ name: "A", type: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.name).toBe("Name is required");
      expect(r.fieldErrors.type).toBe("Select a ledger type");
    }
  });

  it("validates dates in YYYY-MM-DD form", () => {
    expect(voucherDateSchema.safeParse("2026-07-01").success).toBe(true);
    const r = toResult(voucherDateSchema.safeParse("01/07/2026"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Date must be YYYY-MM-DD");
  });
});
