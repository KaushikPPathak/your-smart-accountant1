import { describe, expect, it } from "vitest";
import { defaultSelection, fpsInRange, mergeInwardSummaries, resolveGstPeriod, type GstPeriodSelection } from "@/lib/gst-period";

const base: GstPeriodSelection = {
  mode: "month", month: "2026-06", quarter: 1, quarterYear: 2026, count: 1, from: "2026-04-01", to: "2026-04-30",
};

describe("resolveGstPeriod", () => {
  it("single month is a single return", () => {
    const r = resolveGstPeriod(base);
    expect(r).toMatchObject({ valid: true, from: "2026-06-01", to: "2026-06-30", months: 1, fp: "062026", singleReturn: true });
  });

  it("quarter is a single return keyed by its last month", () => {
    const r = resolveGstPeriod({ ...base, mode: "quarter", quarter: 1, quarterYear: 2026 });
    expect(r).toMatchObject({ from: "2026-04-01", to: "2026-06-30", months: 3, fp: "062026", singleReturn: true });
  });

  it("two months is valid for review but not a filing period", () => {
    const r = resolveGstPeriod({ ...base, mode: "months", month: "2026-04", count: 2 });
    expect(r).toMatchObject({ from: "2026-04-01", to: "2026-05-31", months: 2, singleReturn: false });
    expect(r.label).toBe("Apr 2026 – May 2026 (2 months)");
  });

  it("any N months works, crossing financial years", () => {
    const r = resolveGstPeriod({ ...base, mode: "months", month: "2027-01", count: 5 });
    expect(r.from).toBe("2027-01-01");
    expect(r.to).toBe("2027-05-31");
    expect(r.fps).toEqual(["012027", "022027", "032027", "042027", "052027"]);
  });

  it("3 months starting in a quarter-start month is a quarter return", () => {
    expect(resolveGstPeriod({ ...base, mode: "months", month: "2026-07", count: 3 }).singleReturn).toBe(true);
    expect(resolveGstPeriod({ ...base, mode: "months", month: "2026-08", count: 3 }).singleReturn).toBe(false);
  });

  it("any date range, including partial months", () => {
    const r = resolveGstPeriod({ ...base, mode: "range", from: "2026-04-10", to: "2026-06-20" });
    expect(r).toMatchObject({ valid: true, months: 3, singleReturn: false });
    expect(r.fps).toEqual(["042026", "052026", "062026"]);
  });

  it("rejects a range that ends before it starts", () => {
    expect(resolveGstPeriod({ ...base, mode: "range", from: "2026-06-01", to: "2026-05-01" }).valid).toBe(false);
  });
});

describe("fpsInRange", () => {
  it("lists month keys inclusively", () => {
    expect(fpsInRange("2026-11-15", "2027-01-02")).toEqual(["112026", "122026", "012027"]);
  });
});

describe("defaultSelection", () => {
  it("uses the filing frequency from settings", () => {
    const today = new Date(2026, 10, 18);
    expect(defaultSelection("monthly", today).mode).toBe("month");
    expect(defaultSelection("quarterly", today).mode).toBe("quarter");
    expect(defaultSelection("quarterly", today).quarter).toBe(3);
  });
});

describe("range helpers", () => {
  it("fpsInRange spans year boundaries in order", () => {
    expect(fpsInRange("2026-11-01", "2027-02-28")).toEqual(["112026", "122026", "012027", "022027"]);
  });

  it("fpsInRange returns a single period for one month", () => {
    expect(fpsInRange("2026-04-01", "2026-04-30")).toEqual(["042026"]);
  });

  it("mergeInwardSummaries sums the same ty across months and keeps distinct ty rows", () => {
    const merged = mergeInwardSummaries([
      { ty: "RCM", inter_paise: 100, intra_paise: 50 },
      { ty: "RCM", inter_paise: 200, intra_paise: 25 },
      { ty: "ISD", inter_paise: 10, intra_paise: 0 },
    ]);
    expect(merged).toEqual([
      { ty: "RCM", inter_paise: 300, intra_paise: 75 },
      { ty: "ISD", inter_paise: 10, intra_paise: 0 },
    ]);
  });

  it("mergeInwardSummaries does not mutate its input rows", () => {
    const rows = [
      { ty: "RCM", inter_paise: 1, intra_paise: 1 },
      { ty: "RCM", inter_paise: 2, intra_paise: 2 },
    ];
    mergeInwardSummaries(rows);
    expect(rows[0].inter_paise).toBe(1);
  });
});
