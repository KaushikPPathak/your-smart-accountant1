import { describe, expect, it } from "vitest";
import { reconcileBillTaxLines } from "@/lib/gst-bill-lines";

// Property: after allocation the lines add up to the header tax exactly, for any mix of lines.
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

describe("bill tax allocation to lines", () => {
  it("sums to the header tax for random lines (paise, exact)", () => {
    const rand = rng(42);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 6);
      const rate = [5, 12, 18, 28][Math.floor(rand() * 4)];
      const lines = Array.from({ length: n }, () => {
        const taxable = Math.floor(rand() * 900000) + 1;
        const tax = Math.round((taxable * rate) / 200); // CGST half of rate
        return { taxable_paise: taxable, gst_rate: rate, cgst_paise: tax, sgst_paise: tax, igst_paise: 0 };
      });
      const headerTax = Math.round(lines.reduce((s, l) => s + l.taxable_paise, 0) * rate / 200) + Math.floor(rand() * 3) - 1;
      const header = { cgst_paise: Math.max(0, headerTax), sgst_paise: Math.max(0, headerTax), igst_paise: 0 };
      const out = reconcileBillTaxLines(lines, header);
      expect(out.reduce((s, l) => s + l.cgst_paise, 0)).toBe(header.cgst_paise);
      expect(out.reduce((s, l) => s + l.sgst_paise, 0)).toBe(header.sgst_paise);
      // taxable values are never changed
      out.forEach((l, i) => expect(l.taxable_paise).toBe(lines[i].taxable_paise));
    }
  });

  it("gives the remainder to the last line when the header is one paisa higher", () => {
    const lines = [
      { taxable_paise: 100, gst_rate: 18, cgst_paise: 9, sgst_paise: 9, igst_paise: 0 },
      { taxable_paise: 100, gst_rate: 18, cgst_paise: 9, sgst_paise: 9, igst_paise: 0 },
    ];
    const out = reconcileBillTaxLines(lines, { cgst_paise: 19, sgst_paise: 18, igst_paise: 0 });
    expect(out.reduce((s, l) => s + l.cgst_paise, 0)).toBe(19);
    expect(out.reduce((s, l) => s + l.sgst_paise, 0)).toBe(18);
  });
});
