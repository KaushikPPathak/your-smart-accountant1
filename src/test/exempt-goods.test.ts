import { describe, expect, it } from "vitest";
import { exemptEntryForHsn, natureOfTaxFreeLine } from "@/lib/gst/exempt-goods";

const zero = { gst_rate: 0, igst_paise: 0, cgst_paise: 0, sgst_paise: 0 };

describe("exempt goods list", () => {
  it("matches a heading and its 8-digit codes", () => {
    expect(exemptEntryForHsn("0201")?.serial).toBe("7");
    expect(exemptEntryForHsn("02011000")?.serial).toBe("7");
  });
  it("matches a 4-digit heading entry", () => {
    expect(exemptEntryForHsn("0101")?.serial).toBe("1");
  });
  it("does not match chapter-level rows, which name one product in the chapter", () => {
    expect(exemptEntryForHsn("69110000")).toBeNull(); // "Idols made of clay" is not all of chapter 69
    expect(exemptEntryForHsn("06029010")).toBeNull(); // "Live plants" is not all of chapter 06
  });
  it("matches a listed heading inside a multi-heading entry", () => {
    expect(exemptEntryForHsn("0307")?.serial).toBe("13");
  });
  it("does not match free-text entries", () => {
    expect(exemptEntryForHsn("1701")).toBeNull();
    expect(exemptEntryForHsn("3001")).toBeNull();
  });
  it("returns null for goods not on the list and for empty codes", () => {
    expect(exemptEntryForHsn("6911")).toBeNull();
    expect(exemptEntryForHsn("6912")).toBeNull();
    expect(exemptEntryForHsn("")).toBeNull();
    expect(exemptEntryForHsn(null)).toBeNull();
  });
});

describe("nature of a tax-free line", () => {
  it("is exempt for a zero-rate line whose HSN is on the list", () => {
    expect(natureOfTaxFreeLine({ ...zero, items: { hsn_code: "02011000" } })).toBe("exempt");
  });
  it("is nil-rated for a zero-rate line not on the list", () => {
    expect(natureOfTaxFreeLine({ ...zero, items: { hsn_code: "6911" } })).toBe("nil_rated");
    expect(natureOfTaxFreeLine({ ...zero, items: null })).toBe("nil_rated");
  });
  it("ignores HSN on a taxable line", () => {
    expect(natureOfTaxFreeLine({ gst_rate: 5, igst_paise: 0, cgst_paise: 25, sgst_paise: 25, items: { hsn_code: "0201" } })).toBe("nil_rated");
  });
});

describe("picker label for 0% codes", () => {
  it("labels exempt entries with their entry number and others as nil rated", async () => {
    const { taxFreeLabel } = await import("@/lib/gst/exempt-goods");
    expect(taxFreeLabel("0201")).toBe("Exempt · Notif 10/2025 entry 7");
    expect(taxFreeLabel("6911")).toBe("Nil rated (0%)");
  });
});
