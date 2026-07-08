import { describe, it, expect } from "vitest";
import {
  resolveSeries,
  resolveTaxTemplate,
  shouldPromptBillAllocation,
  shouldAutoOpenTransportPanel,
  shouldShowCostCentre,
  shouldShowBatchColumn,
  shouldShowAltUnitColumn,
  DEFAULT_EWAYBILL_THRESHOLD_PAISE,
  type VoucherSeries,
  type TaxTemplate,
} from "@/lib/voucher-resolver";

const s = (id: string, extra: Partial<VoucherSeries> = {}): VoucherSeries => ({
  id, company_id: "c1", voucher_type: "sales", name: id, prefix: null, ...extra,
});
const t = (id: string, extra: Partial<TaxTemplate> = {}): TaxTemplate => ({
  id, company_id: "c1", name: id,
  gst_rate: 18, cess_rate: 0, is_interstate: false,
  itc_eligible: true, is_reverse_charge: false,
  ...extra,
});

describe("resolveSeries — progressive disclosure", () => {
  it("hidden when no series configured (legacy fallback path)", () => {
    expect(resolveSeries([]).status).toBe("hidden");
  });
  it("auto-applies silently when exactly one series exists", () => {
    const r = resolveSeries([s("A")]);
    expect(r.status).toBe("auto");
    expect(r.value?.id).toBe("A");
  });
  it("auto-applies default when multiple exist with a default", () => {
    const r = resolveSeries([s("A"), s("B", { is_default: true })]);
    expect(r.status).toBe("auto");
    expect(r.value?.id).toBe("B");
  });
  it("ambiguous when multiple exist and none is default", () => {
    const r = resolveSeries([s("A"), s("B")]);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });
});

describe("resolveTaxTemplate — infer, don't ask", () => {
  const gst = "27"; // Maharashtra
  it("hidden when no templates configured", () => {
    const r = resolveTaxTemplate([], {
      companyStateCode: gst,
      party: { gst_treatment: "regular", state_code: gst },
      item: { hsn_code: "8471", gst_rate: 18 },
    });
    expect(r.status).toBe("hidden");
  });
  it("hidden for unregistered party (no GST applicable)", () => {
    const r = resolveTaxTemplate([t("A")], {
      companyStateCode: gst,
      party: { gst_treatment: "unregistered", state_code: gst },
      item: { hsn_code: "8471", gst_rate: 18 },
    });
    expect(r.status).toBe("hidden");
  });
  it("auto-picks by GST rate + intra-state supply", () => {
    const templates = [t("GST18", { gst_rate: 18 }), t("GST12", { gst_rate: 12 })];
    const r = resolveTaxTemplate(templates, {
      companyStateCode: gst,
      party: { gst_treatment: "regular", state_code: gst },
      item: { hsn_code: null, gst_rate: 18 },
    });
    expect(r.status).toBe("auto");
    expect(r.value?.id).toBe("GST18");
  });
  it("prefers HSN prefix match over rate match", () => {
    const templates = [
      t("HSN8471", { gst_rate: 18, hsn_prefix: "8471" }),
      t("GST18", { gst_rate: 18 }),
    ];
    const r = resolveTaxTemplate(templates, {
      companyStateCode: gst,
      party: { gst_treatment: "regular", state_code: gst },
      item: { hsn_code: "84713010", gst_rate: 18 },
    });
    expect(r.status).toBe("auto");
    expect(r.value?.id).toBe("HSN8471");
  });
  it("switches to interstate template when party state differs", () => {
    const templates = [
      t("IGST18", { gst_rate: 18, is_interstate: true }),
      t("GST18", { gst_rate: 18, is_interstate: false }),
    ];
    const r = resolveTaxTemplate(templates, {
      companyStateCode: gst,
      party: { gst_treatment: "regular", state_code: "29" }, // Karnataka
      item: { hsn_code: null, gst_rate: 18 },
    });
    expect(r.status).toBe("auto");
    expect(r.value?.id).toBe("IGST18");
  });
  it("ambiguous → picker required (Save disabled per user rule)", () => {
    const templates = [
      t("GST18-A", { gst_rate: 18 }),
      t("GST18-B", { gst_rate: 18 }),
    ];
    const r = resolveTaxTemplate(templates, {
      companyStateCode: gst,
      party: { gst_treatment: "regular", state_code: gst },
      item: { hsn_code: null, gst_rate: 18 },
    });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });
});

describe("progressive-disclosure gates", () => {
  it("bill-allocation popup only appears with outstanding bills or CN/DN", () => {
    expect(shouldPromptBillAllocation({ outstandingBillCount: 0, voucherType: "sales" })).toBe(false);
    expect(shouldPromptBillAllocation({ outstandingBillCount: 3, voucherType: "sales" })).toBe(true);
    expect(shouldPromptBillAllocation({ outstandingBillCount: 0, voucherType: "credit_note" })).toBe(true);
  });
  it("transport panel auto-opens only above e-way threshold", () => {
    expect(shouldAutoOpenTransportPanel(49_999_00)).toBe(false);
    expect(shouldAutoOpenTransportPanel(DEFAULT_EWAYBILL_THRESHOLD_PAISE)).toBe(true);
  });
  it("cost centre gated by company setting AND optional voucher-type override", () => {
    expect(shouldShowCostCentre({ enabledForCompany: false })).toBe(false);
    expect(shouldShowCostCentre({ enabledForCompany: true })).toBe(true);
    expect(shouldShowCostCentre({ enabledForCompany: true, enabledForVoucherType: false })).toBe(false);
  });
  it("item-grid columns hide when no row needs them", () => {
    const noTracking = [{ batch_tracked: false, serial_tracked: false, alt_unit: null }];
    expect(shouldShowBatchColumn(noTracking)).toBe(false);
    expect(shouldShowAltUnitColumn(noTracking)).toBe(false);
    const oneBatched = [
      { batch_tracked: false, serial_tracked: false, alt_unit: null },
      { batch_tracked: true, serial_tracked: false, alt_unit: null },
    ];
    expect(shouldShowBatchColumn(oneBatched)).toBe(true);
  });
});
