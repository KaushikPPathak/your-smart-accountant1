import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/cache-read", () => ({
  readVouchers: async () => [
    { id: "p1", voucher_type: "purchase", voucher_number: "P-1", voucher_date: "2026-05-02", vendor_invoice_no: "" },
    { id: "s1", voucher_type: "sales", voucher_number: "INV-7", voucher_date: "2026-05-03" },
  ],
  readLedgers: async () => [{ id: "l1", name: "Output CGST", type: "sundry_debtor" }],
}));

import { bookRuleIssues } from "@/lib/gst/book-rule-issues";

describe("bookRuleIssues (6.2 / 6.3)", () => {
  it("flags a purchase with no bill number and points to the row, and is advisory", async () => {
    const r = await bookRuleIssues("c1");
    expect(r.advisory).toBe(true);
    const ref = r.issues.filter((i) => i.kind === "reference");
    expect(ref.map((i) => i.voucher_id)).toEqual(["p1"]);
    expect(r.note).toMatch(/Advisory only/);
  });

  it("flags a ledger filed under the wrong account type", async () => {
    const r = await bookRuleIssues("c1");
    expect(r.issues.some((i) => i.kind === "ledger_type" && i.ledger === "Output CGST")).toBe(true);
  });
});
