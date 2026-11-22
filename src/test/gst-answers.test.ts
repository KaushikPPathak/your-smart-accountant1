import { describe, expect, it } from "vitest";
import { needsMonthText, provisionalText, reconText } from "@/lib/ai/gst-answers";
import { isWellFormedGstin } from "@/lib/gst/tax-compliance";
import { explicitMonthFromText } from "@/lib/gst/period-from-text";

describe("GST chat answers", () => {
  it("asks for the month with candidates and never states a figure", () => {
    const t = needsMonthText("gst_provisional");
    expect(t).toMatch(/Which month/);
    expect(t).toMatch(/Recent completed months/);
    expect(t).not.toMatch(/₹/);
  });

  it("refusal gives the reason and the GSTR-3B link", () => {
    const t = provisionalText({
      status: "refused",
      reason: "Oct 2026 is locked.",
      period: { label: "Oct 2026" },
      screenPath: "/app/reports/gstr3b",
    });
    expect(t).toMatch(/Oct 2026 is locked/);
    expect(t).toMatch(/\/app\/reports\/gstr3b/);
    expect(t).not.toMatch(/PROVISIONAL net/);
  });

  it("a provisional figure is labelled, with the period and reconciliation status", () => {
    const t = provisionalText({
      status: "provisional",
      period: { label: "Sep 2026" },
      netPayableRupees: { igst: 0, cgst: 1200, sgst: 1200, total: 2400 },
      reconciliation: { state: "not_imported", note: "Not reconciled to GSTR-2B: no GSTR-2B has been imported for this period." },
      screenPath: "/app/reports/gstr3b",
    });
    expect(t).toMatch(/PROVISIONAL net GST payable for Sep 2026/);
    expect(t).toMatch(/Not reconciled to GSTR-2B/);
    expect(t).toMatch(/not the filing figure/);
  });

  it("each reconciliation row names the authoritative side", () => {
    const t = reconText({
      status: "ok",
      period: { label: "Sep 2026" },
      counts: { matched: 1, gstr2b_only: 1, books_only: 0, mismatch: 0 },
      rows: [{
        side: "gstr2b_only", supplier: "Acme", invoice_no: "A-1", invoice_date: "2026-09-04",
        books_rupees: null, gstr2b_rupees: 1000,
        authoritative_label: "GSTR-2B decides whether input tax can be claimed",
        guidance: "Not in your books.",
      }],
      screenPath: "/app/reports/gstr2b",
    });
    expect(t).toMatch(/Authoritative: GSTR-2B decides/);
    expect(t).toMatch(/Acme A-1/);
  });
});

describe("GSTIN format and month parsing", () => {
  it("accepts a well-formed GSTIN and rejects a malformed one", () => {
    expect(isWellFormedGstin("09AAAAA0000A1Z5")).toBe(true);
    expect(isWellFormedGstin("09AAAAA0000A1")).toBe(false);
    expect(isWellFormedGstin("")).toBe(false);
    expect(isWellFormedGstin(null)).toBe(false);
  });

  it("reads a month only when the text names one", () => {
    expect(explicitMonthFromText("provisional GST for Oct 2026")).toBe("2026-10");
    expect(explicitMonthFromText("what is my GST?")).toBeUndefined();
  });
});
