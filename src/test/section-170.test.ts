import { describe, expect, it } from "vitest";
import { roundReturnTaxes, roundTaxToRupee } from "@/lib/gst/section-170";

describe("Section 170 rounding", () => {
  it("drops less than 50 paise and rounds 50 paise or more up", () => {
    expect(roundTaxToRupee(1.49)).toBe(1);
    expect(roundTaxToRupee(1.5)).toBe(2);
    expect(roundTaxToRupee(1.99)).toBe(2);
    expect(roundTaxToRupee(0)).toBe(0);
  });

  it("rounds negatives symmetrically", () => {
    expect(roundTaxToRupee(-1.5)).toBe(-2);
    expect(roundTaxToRupee(-1.49)).toBe(-1);
  });

  it("rounds tax heads on return lines and leaves taxable values alone", () => {
    const out = roundReturnTaxes({
      osup_det: { txval: 1000.37, iamt: 0, camt: 90.5, samt: 90.49, csamt: 0 },
      tax_pmt: { iamt: 10.5, camt_payable: 12.25, samt_payable: 3.7 },
    });
    expect(out.osup_det).toEqual({ txval: 1000.37, iamt: 0, camt: 91, samt: 90, csamt: 0 });
    expect(out.tax_pmt.iamt).toBe(11);
    expect(out.tax_pmt.camt_payable).toBe(12);
    expect(out.tax_pmt.samt_payable).toBe(4);
  });

  it("does not mutate the input", () => {
    const input = { camt: 1.5 };
    roundReturnTaxes(input);
    expect(input.camt).toBe(1.5);
  });
});

import { taxDeltas } from "@/lib/gst/section-170";

describe("internal books-to-return differences", () => {
  it("lists only tax figures that the return rounds, with the paise difference", () => {
    const exact = { osup_det: { txval: 1000.37, camt: 90.5 }, tax_pmt: { iamt_payable: 10 } };
    const filed = roundReturnTaxes(exact);
    const d = taxDeltas(exact, filed);
    expect(d).toEqual([{ path: "osup_det.camt", exactRupees: 90.5, filedRupees: 91, deltaRupees: 0.5 }]);
  });
});
