import { describe, expect, it } from "vitest";
import { resolveEditedGstDirection } from "@/lib/vouchers/edit-gst-direction";
import { computeLine, sumLines } from "@/lib/gst";

describe("GST direction after party master correction", () => {
  const company = { state_code: "24", gstin: "24AAAAA0000A1Z5" };
  const saved = { is_interstate: false, place_of_supply_code: "24" };
  it("uses Delhi GSTIN on the Asleen 25000 purchase, not the old local default", () => {
    const draft = resolveEditedGstDirection(saved, company, { gstin: "07AWKPA2547G1ZQ", state_code: "24" });
    expect(draft).toEqual({ is_interstate: true, place_of_supply_code: "07" });
    const totals = sumLines([computeLine({ qty: 1, rate: 25000, discount: 0, gstRate: 5 }, draft.is_interstate)]);
    expect(totals.igst_paise).toBe(1250_00);
    expect(totals.cgst_paise).toBe(0);
    expect(totals.sgst_paise).toBe(0);
    expect(totals.total_paise).toBe(26250_00);
    expect(saved).toEqual({ is_interstate: false, place_of_supply_code: "24" });
  });
  it("preserves a distinct invoice place of supply", () => {
    expect(resolveEditedGstDirection({ is_interstate: true, place_of_supply_code: "36" }, company,
      { gstin: "07AWKPA2547G1ZQ" })).toEqual({ is_interstate: true, place_of_supply_code: "36" });
  });
  it("keeps saved GST direction when company/party state is unknown", () => {
    expect(resolveEditedGstDirection(saved, {}, null)).toEqual(saved);
  });
  it("keeps a Gujarat party local", () => {
    expect(resolveEditedGstDirection(saved, company, { gstin: "24AAAAA0000A1Z5" }).is_interstate).toBe(false);
  });
});