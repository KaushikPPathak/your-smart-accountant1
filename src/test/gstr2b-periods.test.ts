import { describe, expect, it } from "vitest";
import { coverageForRange, monthsCoveredBy, g2bMonthOf, g2bPeriodInRange, normaliseG2bPeriod } from "@/lib/gstr2b-periods";
import { resolveGstPeriod } from "@/lib/gst-period";

const range = (sel: Parameters<typeof resolveGstPeriod>[0]) => {
  const r = resolveGstPeriod(sel);
  return { fps: r.fps, from: r.from, to: r.to };
};

describe("normaliseG2bPeriod", () => {
  it("reads the common shapes", () => {
    expect(normaliseG2bPeriod("042026")).toMatchObject({ kind: "month", fp: "042026", ym: "2026-04" });
    expect(normaliseG2bPeriod("04-2026")).toMatchObject({ kind: "month", fp: "042026" });
    expect(normaliseG2bPeriod("Apr-2026")).toMatchObject({ kind: "month", fp: "042026" });
    expect(normaliseG2bPeriod("April 2026")).toMatchObject({ kind: "month", fp: "042026" });
    expect(normaliseG2bPeriod("2025-26")).toEqual({ kind: "fy", from: "2025-04-01", to: "2026-03-31" });
  });

  it("returns null for blanks and garbage", () => {
    expect(normaliseG2bPeriod("")).toBeNull();
    expect(normaliseG2bPeriod(null)).toBeNull();
    expect(normaliseG2bPeriod("13-2026")).toBeNull();
    expect(normaliseG2bPeriod("hello")).toBeNull();
  });
});

describe("g2bPeriodInRange", () => {
  it("includes only months inside a multi-month range", () => {
    const r = range({ mode: "months", month: "2026-04", count: 3, quarter: 1, quarterYear: 2026, from: "", to: "" });
    expect(g2bPeriodInRange("042026", "", r)).toBe(true);
    expect(g2bPeriodInRange("062026", "", r)).toBe(true);
    expect(g2bPeriodInRange("072026", "", r)).toBe(false);
  });

  it("uses the line's own period before the import's period", () => {
    const r = range({ mode: "month", month: "2026-05", count: 1, quarter: 1, quarterYear: 2026, from: "", to: "" });
    expect(g2bPeriodInRange("052026", "042026", r)).toBe(true);
    expect(g2bPeriodInRange(null, "052026", r)).toBe(true);
    expect(g2bPeriodInRange(null, "042026", r)).toBe(false);
  });

  it("keeps lines with unknown periods visible", () => {
    const r = range({ mode: "month", month: "2026-05", count: 1, quarter: 1, quarterYear: 2026, from: "", to: "" });
    expect(g2bPeriodInRange(null, null, r)).toBe(true);
  });

  it("matches a financial-year import when it overlaps the range", () => {
    const r = range({ mode: "range", month: "2026-01", count: 1, quarter: 1, quarterYear: 2026, from: "2026-01-01", to: "2026-02-28" });
    expect(g2bPeriodInRange(null, "2025-26", r)).toBe(true);
    expect(g2bPeriodInRange(null, "2026-27", r)).toBe(false);
  });
});

describe("coverage", () => {
  it("marks which months in the range have data", () => {
    const out = coverageForRange(new Set(["2026-04", "2026-06"]), { from: "2026-04-01", to: "2026-06-30" });
    expect(out).toEqual([
      { ym: "2026-04", imported: true },
      { ym: "2026-05", imported: false },
      { ym: "2026-06", imported: true },
    ]);
  });

  it("reports the month of a line", () => {
    expect(g2bMonthOf("Apr-2026", null)).toBe("2026-04");
    expect(g2bMonthOf("2025-26", null)).toBeNull();
  });

  it("expands a financial-year import into its twelve months", () => {
    const months = monthsCoveredBy(null, "2025-26");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-04");
    expect(months[11]).toBe("2026-03");
    expect(monthsCoveredBy("062026", null)).toEqual(["2026-06"]);
  });
});
