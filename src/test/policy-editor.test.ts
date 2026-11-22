import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY, policyFromForm, policySourceLine, policyToForm } from "@/lib/policy-settings";

const defaults = policyToForm(DEFAULT_POLICY);

describe("threshold editor validation", () => {
  it("round-trips the defaults through the form", () => {
    const r = policyFromForm(defaults);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy).toEqual(DEFAULT_POLICY);
  });

  it("rejects negative and non-numeric values", () => {
    const r = policyFromForm({ ...defaults, stockAbsRupees: "-1", roundOffRupees: "abc", advanceRupees: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.stockAbsRupees).toBeTruthy();
      expect(r.errors.roundOffRupees).toBeTruthy();
      expect(r.errors.advanceRupees).toBeTruthy();
    }
  });

  it("keeps the percentage between 0 and 1", () => {
    expect(policyFromForm({ ...defaults, stockPct: "1.5" }).ok).toBe(false);
    expect(policyFromForm({ ...defaults, stockPct: "0" }).ok).toBe(true);
    expect(policyFromForm({ ...defaults, stockPct: "1" }).ok).toBe(true);
  });

  it("caps round-off at ₹10", () => {
    expect(policyFromForm({ ...defaults, roundOffRupees: "10" }).ok).toBe(true);
    const over = policyFromForm({ ...defaults, roundOffRupees: "11" });
    expect(over.ok).toBe(false);
  });

  it("caps the advance notice at ₹10,000, so 1,00,000 for 1,000 is refused", () => {
    expect(policyFromForm({ ...defaults, advanceRupees: "10000" }).ok).toBe(true);
    const typo = policyFromForm({ ...defaults, advanceRupees: "100000" });
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.errors.advanceRupees).toMatch(/cap/);
  });

  it("converts the entered values to paise and basis points", () => {
    const r = policyFromForm({ stockAbsRupees: "750", stockPct: "0.02", roundOffRupees: "1", advanceRupees: "2500" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.policy).toEqual({
        countVarianceFloorPaise: 75_000,
        countVarianceRateBps: 200,
        roundOffAutoPaise: 100,
        advanceNoticePaise: 250_000,
      });
    }
  });

  it("states where the values came from", () => {
    expect(policySourceLine({ synced: true })).toMatch(/company record/);
    expect(policySourceLine({ synced: false, reason: "missing" })).toMatch(/no thresholds yet/);
    expect(policySourceLine({ synced: false, reason: "newer_version" })).toMatch(/newer format/);
  });
});

// The read path must never write. Opening company settings with no network leaves the cache unchanged.
const cache = vi.hoisted(() => ({ rows: new Map<string, any>() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, { get() { throw new Error("network access attempted during a read"); } }),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDb: {
    cache_companies: {
      get: async (id: string) => cache.rows.get(id),
      put: async (row: any) => { cache.rows.set(row.id, structuredClone(row)); },
      update: async () => { throw new Error("read path must not update the cache"); },
    },
  },
}));

import { loadPolicy, loadPolicyStatus } from "@/lib/policy-settings";

describe("reading thresholds never writes", () => {
  beforeEach(() => {
    cache.rows.clear();
    cache.rows.set("c1", {
      id: "c1",
      name: "Test",
      policy_thresholds: { v: 1, stockAbsPaise: 60_000, stockBps: 200, roundOffPaise: 100, advancePaise: 100_000 },
    });
  });

  it("the cache is byte-identical after several reads with no network", async () => {
    const before = JSON.stringify([...cache.rows.entries()]);
    await loadPolicy("c1");
    await loadPolicyStatus("c1");
    await loadPolicyStatus("unknown-company");
    expect(JSON.stringify([...cache.rows.entries()])).toBe(before);
  });
});
