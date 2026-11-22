import { describe, expect, it } from "vitest";
import { explicitMonthFromText, recentCompletedMonths } from "@/lib/gst/period-from-text";

describe("explicit month only", () => {
  it("reads a named month with its year", () => {
    expect(explicitMonthFromText("GST for Oct 2026")).toBe("2026-10");
    expect(explicitMonthFromText("net gst for October 2026?")).toBe("2026-10");
    expect(explicitMonthFromText("period 2026-03")).toBe("2026-03");
  });
  it("does not infer a month from a bare name or no month at all", () => {
    expect(explicitMonthFromText("what's my GST in October")).toBeUndefined();
    expect(explicitMonthFromText("what's my GST?")).toBeUndefined();
  });
  it("offers the three most recent completed months, newest first", () => {
    const c = recentCompletedMonths(new Date(2026, 10, 22)); // 22 Nov 2026
    expect(c.map((x) => x.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(c[0].label).toBe("Oct 2026");
  });
  it("crosses the year boundary", () => {
    expect(recentCompletedMonths(new Date(2026, 1, 5), 2).map((x) => x.month)).toEqual(["2026-01", "2025-12"]);
  });
});
