import { describe, expect, it } from "vitest";
import { bucketOfLedger, inputTaxKindOf, journalItcVouchers, purchaseBucketHints, type BooksLedger, type BooksLine } from "@/lib/gst-itc-from-books";

// Ledgers and figures from the Tally journals on Jash Enterprise (Dec 2025 to Jan 2026).
const ledgers = new Map<string, BooksLedger>([
  ["furn", { name: "Furniture", type: "fixed_asset", group: "Fixed Assets" }],
  ["ac", { name: "Ac Machine", type: "fixed_asset", group: "Fixed Assets" }],
  ["icgst", { name: "INPUT CGST @ 9%", type: "duties_taxes", group: "Duties & Taxes" }],
  ["isgst", { name: "INPUT SGST @ 9%", type: "duties_taxes", group: "Duties & Taxes" }],
  ["ocgst", { name: "OUTPUT SGST@ 9%", type: "duties_taxes", group: "Duties & Taxes" }],
  ["party", { name: "Desire Hvac Engineers", type: "sundry_creditor", group: "Sundry Creditors" }],
  ["efo", { name: "Electrical Fittings Office", type: "sundry_creditor", group: "Sundry Creditors" }],
  ["rnd", { name: "Round Off", type: "expense_indirect", group: "Indirect Expenses" }],
  ["rep", { name: "REPAIRING EXPENSES", type: "expense_indirect", group: "Indirect Expenses" }],
  ["purch", { name: "Purchase A/c", type: "expense_direct", group: "Purchase Accounts" }],
]);

const L = (voucherId: string, voucherType: string, ledgerId: string, dr: number, cr: number, date = "2025-12-12", num = voucherId): BooksLine =>
  ({ voucherId, voucherType, voucherDate: date, voucherNumber: num, ledgerId, debitPaise: dr, creditPaise: cr });

describe("input tax ledgers", () => {
  it("recognises input CGST, SGST and IGST and ignores output tax", () => {
    expect(inputTaxKindOf("INPUT CGST @ 9%")).toBe("cgst");
    expect(inputTaxKindOf("INPUT SGST @ 9%")).toBe("sgst");
    expect(inputTaxKindOf("Input IGST")).toBe("igst");
    expect(inputTaxKindOf("OUTPUT SGST@ 9%")).toBeNull();
    expect(inputTaxKindOf("Round Off")).toBeNull();
  });
});

describe("class of the ledger the ITC was posted against", () => {
  it("fixed asset is capital goods; expense outside purchases is expenses; supplier or Purchase A/c is goods", () => {
    expect(bucketOfLedger(ledgers.get("furn"))).toBe("capitalGoods");
    expect(bucketOfLedger(ledgers.get("rep"))).toBe("inputServices");
    expect(bucketOfLedger(ledgers.get("purch"))).toBe("inputs");
    expect(bucketOfLedger(ledgers.get("efo"))).toBe("inputs");
  });
});

describe("journal ITC", () => {
  it("counts Furniture journal as capital goods with its CGST and SGST", () => {
    const lines = [
      L("j19", "journal", "furn", 2408395, 0),
      L("j19", "journal", "icgst", 216755, 0),
      L("j19", "journal", "isgst", 216755, 0),
      L("j19", "journal", "party", 0, 2841900),
    ];
    const [v] = journalItcVouchers(lines, ledgers);
    expect(v.bucket).toBe("capitalGoods");
    expect(v.taxablePaise).toBe(2408395);
    expect(v.cgstPaise).toBe(216755);
    expect(v.sgstPaise).toBe(216755);
  });

  it("counts Ac Machine journal as capital goods", () => {
    const lines = [
      L("j38", "journal", "ac", 3728814, 0),
      L("j38", "journal", "icgst", 335593, 0),
      L("j38", "journal", "isgst", 335593, 0),
      L("j38", "journal", "party", 0, 4400000),
    ];
    const [v] = journalItcVouchers(lines, ledgers);
    expect(v.bucket).toBe("capitalGoods");
    expect(v.taxablePaise).toBe(3728814);
  });

  it("leaves OUTPUT tax out of ITC and reports the supplier journal as goods", () => {
    const lines = [
      L("j50", "journal", "efo", 1446321, 0),
      L("j50", "journal", "icgst", 130168, 0),
      L("j50", "journal", "ocgst", 130168, 0),
      L("j50", "journal", "rnd", 0, 0),
      L("j50", "journal", "party", 0, 1706700),
    ];
    const [v] = journalItcVouchers(lines, ledgers);
    expect(v.bucket).toBe("inputs");
    expect(v.cgstPaise).toBe(130168);
    expect(v.sgstPaise).toBe(0);
    expect(v.taxablePaise).toBe(1446321);
  });

  it("ignores journals with no input tax, and payments are not journals", () => {
    const lines = [
      L("j1", "journal", "rep", 500000, 0),
      L("j1", "journal", "party", 0, 500000),
      L("p1", "payment", "rep", 500000, 0),
    ];
    expect(journalItcVouchers(lines, ledgers)).toHaveLength(0);
  });
});

describe("purchase class when none is stored", () => {
  it("infers the class from the main purchase-side credit, skipping the party and tax", () => {
    const lines = [
      L("p-goods", "purchase", "icgst", 100, 0),
      L("p-goods", "purchase", "purch", 0, 1000),
      L("p-goods", "purchase", "party", 0, 1180),
      L("p-svc", "purchase", "rep", 0, 2000),
      L("p-svc", "purchase", "party", 0, 2360),
      L("p-cap", "purchase", "furn", 0, 3000),
      L("p-cap", "purchase", "party", 0, 3540),
    ];
    const hints = purchaseBucketHints(lines, ledgers);
    expect(hints.get("p-goods")).toBe("inputs");
    expect(hints.get("p-svc")).toBe("inputServices");
    expect(hints.get("p-cap")).toBe("capitalGoods");
  });
});

describe("class chosen by the user for a ledger", () => {
  it("reclassifies every journal posted to a supplier ledger", () => {
    const lines = [
      L("j50", "journal", "efo", 1446321, 0),
      L("j50", "journal", "icgst", 130168, 0),
      L("j50", "journal", "party", 0, 1576489),
      L("j51", "journal", "efo", 500000, 0),
      L("j51", "journal", "isgst", 45000, 0),
      L("j51", "journal", "party", 0, 545000),
    ];
    const overrides = new Map([["efo", "capitalGoods" as const]]);
    const vs = journalItcVouchers(lines, ledgers, overrides);
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.bucket === "capitalGoods")).toBe(true);
    expect(vs[0].againstLedgerId).toBe("efo");
  });

  it("applies an override to a purchase-side ledger", () => {
    const lines = [
      L("p1", "purchase", "purch", 0, 1000),
      L("p1", "purchase", "party", 0, 1180),
    ];
    expect(purchaseBucketHints(lines, ledgers, new Map([["purch", "inputServices" as const]])).get("p1")).toBe("inputServices");
  });
});

describe("blocked class", () => {
  it("a ledger set to blocked gives an ineligible journal, not claimable ITC", () => {
    const lines = [
      L("j60", "journal", "efo", 1000000, 0),
      L("j60", "journal", "icgst", 90000, 0),
      L("j60", "journal", "isgst", 90000, 0),
      L("j60", "journal", "party", 0, 1180000),
    ];
    const [v] = journalItcVouchers(lines, ledgers, new Map([["efo", "ineligible" as const]]));
    expect(v.bucket).toBe("ineligible");
    expect(v.cgstPaise + v.sgstPaise).toBe(180000);
  });
});
