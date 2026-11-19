import { describe, expect, it } from "vitest";
import { isRealCalendarDate, validateItemVoucher, voucherDateSchema } from "@/lib/schemas/voucher";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const line = (over: Partial<Record<string, number>> = {}) => ({
  item_id: ID2, line_no: 1, qty: 1, rate_paise: 10000, discount_paise: 0, amount_paise: 10000,
  taxable_paise: 10000, gst_rate: 18, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, ...over,
});

const voucher = (over: Record<string, unknown> = {}) => ({
  company_id: ID, voucher_type: "sales", voucher_date: "2026-07-01", party_ledger_id: ID,
  is_interstate: false, subtotal_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0,
  round_off_paise: 0, total_paise: 11800, items: [line()], ...over,
});

describe("real calendar dates", () => {
  it("rejects days that do not exist in the month", () => {
    expect(isRealCalendarDate("2026-02-31")).toBe(false);
    expect(isRealCalendarDate("2026-04-31")).toBe(false);
    expect(isRealCalendarDate("2027-02-29")).toBe(false);
    expect(voucherDateSchema.safeParse("2026-02-31").success).toBe(false);
  });

  it("accepts real dates, including leap days", () => {
    expect(isRealCalendarDate("2026-03-31")).toBe(true);
    expect(isRealCalendarDate("2028-02-29")).toBe(true);
    expect(isRealCalendarDate("2000-02-29")).toBe(true);
    expect(isRealCalendarDate("1900-02-29")).toBe(false);
  });

  it("rejects months and days out of range", () => {
    expect(isRealCalendarDate("2026-13-01")).toBe(false);
    expect(isRealCalendarDate("2026-00-10")).toBe(false);
    expect(isRealCalendarDate("2026-06-00")).toBe(false);
  });
});

describe("item voucher reconciliation (mirrors the database checks)", () => {
  it("accepts a consistent intra-state voucher", () => {
    expect(validateItemVoucher(voucher()).ok).toBe(true);
  });

  it("rejects header CGST that does not match the item lines", () => {
    const r = validateItemVoucher(voucher({ cgst_paise: 500, total_paise: 11400 }));
    expect(r.ok).toBe(false);
  });

  it("allows a one-paisa tolerance on header tax, as the database does", () => {
    const r = validateItemVoucher(voucher({ cgst_paise: 901, total_paise: 11801 }));
    expect(r.ok).toBe(true);
  });

  it("rejects a header total that is not subtotal + taxes + round-off", () => {
    expect(validateItemVoucher(voucher({ total_paise: 11801 })).ok).toBe(false);
  });

  it("counts round-off in the total", () => {
    const r = validateItemVoucher(voucher({ round_off_paise: 2, total_paise: 11802 }));
    expect(r.ok).toBe(true);
  });

  it("rejects a line whose CGST and SGST differ", () => {
    const r = validateItemVoucher(voucher({ items: [line({ sgst_paise: 800 })], sgst_paise: 800, total_paise: 11700 }));
    expect(r.ok).toBe(false);
  });

  it("rejects a line that mixes IGST with CGST/SGST", () => {
    const r = validateItemVoucher(voucher({ items: [line({ igst_paise: 100 })], igst_paise: 100, total_paise: 11900 }));
    expect(r.ok).toBe(false);
  });

  it("rejects amounts above the safe cap", () => {
    expect(validateItemVoucher(voucher({ subtotal_paise: 2_000_000_000_000 })).ok).toBe(false);
  });

  it("rejects an impossible date on an item voucher", () => {
    expect(validateItemVoucher(voucher({ voucher_date: "2026-02-31" })).ok).toBe(false);
  });
});
