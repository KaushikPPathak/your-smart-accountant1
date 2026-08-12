import { describe, it, expect } from "vitest";
import { assertVoucherBalanced, VoucherInvariantError } from "@/lib/voucher-invariants";

const ctx = { voucherType: "sales", companyId: "c1" };

describe("assertVoucherBalanced", () => {
  it("accepts a balanced sales entry", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "cash", debit_paise: 11800, credit_paise: 0 },
      { ledger_id: "sales", debit_paise: 0, credit_paise: 10000 },
      { ledger_id: "cgst", debit_paise: 0, credit_paise: 900 },
      { ledger_id: "sgst", debit_paise: 0, credit_paise: 900 },
    ], ctx)).not.toThrow();
  });

  it("rejects Dr ≠ Cr by 1 paise", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "cash", debit_paise: 11801, credit_paise: 0 },
      { ledger_id: "sales", debit_paise: 0, credit_paise: 11800 },
    ], ctx)).toThrow(VoucherInvariantError);
  });

  it("rejects empty / single-entry vouchers", () => {
    expect(() => assertVoucherBalanced([], ctx)).toThrow(/no ledger entries/);
    expect(() => assertVoucherBalanced([
      { ledger_id: "cash", debit_paise: 100, credit_paise: 0 },
    ], ctx)).toThrow(/at least two/);
  });

  it("rejects negative amounts and non-integers", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "a", debit_paise: -100, credit_paise: 0 },
      { ledger_id: "b", debit_paise: 0, credit_paise: -100 },
    ], ctx)).toThrow(/invalid debit_paise/);
    expect(() => assertVoucherBalanced([
      { ledger_id: "a", debit_paise: 100.5, credit_paise: 0 },
      { ledger_id: "b", debit_paise: 0, credit_paise: 100.5 },
    ], ctx)).toThrow(/invalid debit_paise/);
  });

  it("rejects entries with both Dr and Cr set", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "a", debit_paise: 100, credit_paise: 100 },
      { ledger_id: "b", debit_paise: 0, credit_paise: 0 },
    ], ctx)).toThrow(/both debit and credit/);
  });

  it("rejects entries with no ledger_id", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "", debit_paise: 100, credit_paise: 0 },
      { ledger_id: "b", debit_paise: 0, credit_paise: 100 },
    ], ctx)).toThrow(/no ledger_id/);
  });

  it("rejects all-zero vouchers", () => {
    expect(() => assertVoucherBalanced([
      { ledger_id: "a", debit_paise: 0, credit_paise: 0 },
      { ledger_id: "b", debit_paise: 0, credit_paise: 0 },
    ], ctx)).toThrow(/zero/);
  });
});
