import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, countVarianceNeedsReason, policyBlob, readPolicyBlob } from "@/lib/policy-settings";

describe("count variance rule (5.4)", () => {
  it("uses the ₹500 floor on a small line", () => {
    expect(countVarianceNeedsReason(40_000, 100_000, DEFAULT_POLICY)).toBe(false); // ₹400 on ₹1,000
    expect(countVarianceNeedsReason(60_000, 100_000, DEFAULT_POLICY)).toBe(true); // ₹600 on ₹1,000
  });
  it("uses 1% of the line value when the line is large", () => {
    // ₹2,000 on ₹10 lakh: 1% is ₹10,000, so the floor of ₹500 is not the limit
    expect(countVarianceNeedsReason(200_000, 100_000_000, DEFAULT_POLICY)).toBe(false);
    expect(countVarianceNeedsReason(1_100_000, 100_000_000, DEFAULT_POLICY)).toBe(true); // ₹11,000
  });
  it("treats a shortage the same as a surplus", () => {
    expect(countVarianceNeedsReason(-60_000, 100_000, DEFAULT_POLICY)).toBe(true);
  });
});

describe("policy from the company record (sync, 5.4 / 6.5)", () => {
  const good = { v: 1, stockAbsPaise: 60_000, stockBps: 200, roundOffPaise: 150, advancePaise: 200_000 };

  it("reads a version-1 blob", () => {
    const r = readPolicyBlob(good);
    expect(r.status).toEqual({ synced: true });
    expect(r.policy).toEqual({
      countVarianceFloorPaise: 60_000,
      countVarianceRateBps: 200,
      roundOffAutoPaise: 150,
      advanceNoticePaise: 200_000,
    });
  });

  it("reads a JSON string as well as an object", () => {
    expect(readPolicyBlob(JSON.stringify(good)).status).toEqual({ synced: true });
  });

  it("falls back to defaults and says why when the blob is missing", () => {
    const r = readPolicyBlob(null);
    expect(r.status).toEqual({ synced: false, reason: "missing" });
    expect(r.policy).toEqual(DEFAULT_POLICY);
  });

  it("falls back when the blob is from a newer format this app does not understand", () => {
    const r = readPolicyBlob({ ...good, v: 2 });
    expect(r.status).toEqual({ synced: false, reason: "newer_version" });
    expect(r.policy).toEqual(DEFAULT_POLICY);
  });

  it("falls back when a value is missing or not a usable number", () => {
    expect(readPolicyBlob({ ...good, stockBps: "1" }).status).toEqual({ synced: false, reason: "invalid" });
    expect(readPolicyBlob({ ...good, roundOffPaise: -1 }).status).toEqual({ synced: false, reason: "invalid" });
    expect(readPolicyBlob("not json").status).toEqual({ synced: false, reason: "invalid" });
  });

  it("round-trips through the stored shape", () => {
    expect(readPolicyBlob(policyBlob(DEFAULT_POLICY)).policy).toEqual(DEFAULT_POLICY);
  });
});
