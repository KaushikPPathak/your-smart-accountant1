import { describe, expect, it } from "vitest";
import { detectVoucherIntent } from "@/lib/voucher-intent";
import { parseAmount } from "@/lib/ai/voucher-actions";

describe("assistant word directory: voucher type", () => {
  it.each([
    ["received 5000 from Ram in HDFC", "receipt"],
    ["cheque from Ram 5000 deposited in bank", "receipt"],
    ["collected 2500 from Sita", "receipt"],
    ["mila 5000 Ram se", "receipt"],
    ["jama kiya 5000 HDFC", "receipt"],
    ["paid 1200 to landlord cash", "payment"],
    ["gave 500 to Ram", "payment"],
    ["neft to Jainam 9000", "payment"],
    ["chukaya 3000 Ramesh ko", "payment"],
    ["kharcha 700 cash", "payment"],
    ["sales 25000 to Ram Traders", "sales"],
    ["sold 4000 to Mohan", "sales"],
    ["vechyu 4000 Mohan ne", "sales"],
    ["bought 8000 from Shyam", "purchase"],
    ["kharidyu 8000 Shyam pase", "purchase"],
  ])("%s -> %s", (text, expected) => {
    expect(detectVoucherIntent(text)).toBe(expected);
  });

  it("does not treat questions or reports as entries", () => {
    expect(detectVoucherIntent("what is the balance of Ram")).toBeNull();
    expect(detectVoucherIntent("sales register 2025")).toBeNull();
    expect(detectVoucherIntent("show day book")).toBeNull();
  });

  it("does not match a word inside a longer word", () => {
    expect(detectVoucherIntent("unpaid bills of Ram")).toBeNull();
  });
});

describe("assistant amount reading", () => {
  it("does not read a cheque number as the amount", () => {
    expect(parseAmount("cheque no 123456 for Rs 5000")).toBe(5000);
    expect(parseAmount("cheque 987654 paid to Ram 2500")).toBe(2500);
  });

  it("does not read a UTR or NEFT reference as the amount", () => {
    expect(parseAmount("UTR 4455667788 paid 2500")).toBe(2500);
    expect(parseAmount("neft ref 123456789 received 9000")).toBe(9000);
  });

  it("does not read an invoice number as the amount", () => {
    expect(parseAmount("invoice no 1234 amount 9500")).toBe(9500);
  });

  it("still reads a bill amount that is not a number label", () => {
    expect(parseAmount("bill 25000 to Ram")).toBe(25000);
  });

  it("prefers the amount after a rupee mark", () => {
    expect(parseAmount("paid Rs 50000 to Ram, ref 99999999")).toBe(50000);
  });

  it("keeps Indian grouping", () => {
    expect(parseAmount("Rs. 50,0000 received")).toBe(500000);
    expect(parseAmount("1,50,000 received")).toBe(150000);
  });
});
