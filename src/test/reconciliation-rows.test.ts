import { describe, expect, it } from "vitest";
import { classifyReconRows } from "@/lib/gst/reconciliation-rows";
import type { BookPurchase, ReconResult } from "@/lib/gstr2b-recon";

const parsed = (invoice_no: string, value: number) => ({
  supplier_gstin: "09AAAAA0000A1Z5", supplier_name: "Supplier A", invoice_no, invoice_date: "2026-10-05",
  invoice_value_paise: value, taxable_paise: value, igst_paise: 0, cgst_paise: 0, sgst_paise: 0,
});
const book = (id: string, number: string, total: number): BookPurchase => ({
  id, voucher_number: number, voucher_date: "2026-10-06", total_paise: total, vendor_invoice_no: number, ledgers: { name: "Supplier A", gstin: null },
});

describe("classifyReconRows (6.2 authoritative side)", () => {
  const books = [book("b1", "INV-1", 100000), book("b2", "INV-2", 50000), book("b3", "INV-9", 70000)];
  const results: ReconResult[] = [
    { row: parsed("INV-1", 100000), match_status: "matched", matched_voucher_id: "b1" },
    { row: parsed("INV-2", 52000), match_status: "value_mismatch", matched_voucher_id: "b2" },
    { row: parsed("INV-7", 30000), match_status: "unmatched", matched_voucher_id: null },
  ];
  const out = classifyReconRows(results, books);

  it("counts matched rows without listing them", () => {
    expect(out.counts.matched).toBe(1);
    expect(out.rows.some((r) => r.voucher_id === "b1")).toBe(false);
  });

  it("GSTR-2B only: GSTR-2B is authoritative, books are not changed to match it", () => {
    const r = out.rows.find((x) => x.side === "gstr2b_only")!;
    expect(r.authoritative).toBe("gstr2b");
    expect(r.books_rupees).toBeNull();
    expect(r.guidance).toMatch(/Record the purchase only if you hold this bill/);
  });

  it("books only: the books keep the purchase; GSTR-2B decides the credit", () => {
    const r = out.rows.find((x) => x.side === "books_only")!;
    expect(r.invoice_no).toBe("INV-9");
    expect(r.authoritative).toBe("gstr2b");
    expect(r.guidance).toMatch(/Do not delete the purchase/);
  });

  it("mismatch: the source invoice decides, with both figures shown", () => {
    const r = out.rows.find((x) => x.side === "mismatch")!;
    expect(r.authoritative).toBe("source_invoice");
    expect(r.books_rupees).toBe(500);
    expect(r.gstr2b_rupees).toBe(520);
    expect(r.guidance).toMatch(/Check the supplier's bill/);
  });
});
