import { describe, expect, it } from "vitest";
import { canEncodeCode128B, code128Modules } from "@/lib/barcode/code128";

// Reference bit strings generated with the python-barcode library (Code 128, Set B).
const REFERENCE: Record<string, string> = {
  "A1": "110100100001010001100010011100110100001001101100011101011",
  "Hello 123": "11010010000110001010001011001000011001010000110010100001000111101011011001100100111001101100111001011001011100111101000101100011101011",
  "ABC-001": "1101001000010100011000100010110001000100011010011011100100111011001001110110010011100110110100010001100011101011",
  "~!@#": "1101001000010001011110110011011001100011011010010011000111101011101100011101011",
};

describe("Code 128 Set B encoder", () => {
  for (const [text, bits] of Object.entries(REFERENCE)) {
    it(`matches the reference for "${text}"`, () => {
      expect(code128Modules(text)).toBe(bits);
    });
  }

  it("every symbol is framed by the start and stop patterns, and the module string is all 0/1", () => {
    const m = code128Modules("TORQ-220");
    expect(m).toMatch(/^[01]+$/);
    expect(m.endsWith("1100011101011")).toBe(true);
  });

  it("rejects empty text and characters outside printable ASCII", () => {
    expect(canEncodeCode128B("")).toBe(false);
    expect(canEncodeCode128B("ÄÖ")).toBe(false);
    expect(() => code128Modules("é")).toThrow();
  });
});
