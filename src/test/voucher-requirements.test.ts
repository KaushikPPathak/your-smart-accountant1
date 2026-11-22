import { describe, expect, it } from "vitest";
import { missingRequirements } from "@/lib/voucher-requirements";

describe("voucher requirements (7.3)", () => {
  it("requires a supplier bill number on purchases", () => {
    expect(missingRequirements({ voucherType: "purchase", documentRef: " " })[0]).toMatch(/bill number/);
    expect(missingRequirements({ voucherType: "purchase", documentRef: "B-12" })).toEqual([]);
  });
  it("requires a reference on journals, not on contra", () => {
    expect(missingRequirements({ voucherType: "journal", documentRef: "" })).toHaveLength(1);
    expect(missingRequirements({ voucherType: "contra" })).toEqual([]);
  });
  it("requires an instrument reference only for bank payments and receipts", () => {
    expect(missingRequirements({ voucherType: "payment", bankMode: true, instrumentRef: "" })).toHaveLength(1);
    expect(missingRequirements({ voucherType: "payment", bankMode: false })).toEqual([]);
    expect(missingRequirements({ voucherType: "receipt", bankMode: true, instrumentRef: "UTR123" })).toEqual([]);
  });
  it("requires a cost centre on expense-side payments only when cost centres are enabled", () => {
    expect(missingRequirements({ voucherType: "payment", expenseSide: true, costCentresEnabled: true })).toHaveLength(1);
    expect(missingRequirements({ voucherType: "payment", expenseSide: true, costCentresEnabled: false })).toEqual([]);
    expect(missingRequirements({ voucherType: "payment", expenseSide: true, costCentresEnabled: true, costCentreId: "c1" })).toEqual([]);
  });
  it("never requires a cost centre on tax-only or income entries", () => {
    expect(missingRequirements({ voucherType: "journal", documentRef: "J-1", taxOnly: true, expenseSide: true, costCentresEnabled: true })).toEqual([]);
    expect(missingRequirements({ voucherType: "sales", expenseSide: false, costCentresEnabled: true, documentRef: "I-1" })).toEqual([]);
  });
});
