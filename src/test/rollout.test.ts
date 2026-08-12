// Layer 6 tests — release channel + deterministic feature bucketing.
import { beforeEach, describe, expect, it } from "vitest";
import {
  getChannel,
  setChannel,
  getDeviceId,
  hashToPercent,
  isFeatureEnabled,
} from "@/lib/rollout";

describe("rollout: channel", () => {
  beforeEach(() => { localStorage.clear(); });

  it("defaults to stable", () => {
    expect(getChannel()).toBe("stable");
  });

  it("persists channel changes", () => {
    setChannel("beta");
    expect(getChannel()).toBe("beta");
    setChannel("stable");
    expect(getChannel()).toBe("stable");
  });

  it("ignores unknown values on read", () => {
    localStorage.setItem("rollout.channel.v1", "garbage");
    expect(getChannel()).toBe("stable");
  });
});

describe("rollout: device id", () => {
  beforeEach(() => { localStorage.clear(); });

  it("is stable across calls", () => {
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(4);
  });
});

describe("rollout: hashToPercent", () => {
  it("is deterministic", () => {
    expect(hashToPercent("hello")).toBe(hashToPercent("hello"));
  });
  it("stays in [0,100)", () => {
    for (let i = 0; i < 200; i++) {
      const v = hashToPercent("input-" + i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });
  it("distributes reasonably across the range", () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      buckets[Math.floor(hashToPercent("k-" + i) / 10)]++;
    }
    // Every 10-wide bucket should get at least 30 hits out of 1000
    // — a lopsided hash would leave some empty.
    for (const b of buckets) expect(b).toBeGreaterThan(30);
  });
});

describe("rollout: isFeatureEnabled", () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns false at 0%", () => {
    expect(isFeatureEnabled("x", 0)).toBe(false);
  });
  it("returns true at 100%", () => {
    expect(isFeatureEnabled("x", 100)).toBe(true);
  });
  it("beta channel enables everything below 100%", () => {
    setChannel("beta");
    expect(isFeatureEnabled("anything", 1)).toBe(true);
  });
  it("is stable for the same device+feature", () => {
    const a = isFeatureEnabled("feat-a", 50);
    const b = isFeatureEnabled("feat-a", 50);
    expect(a).toBe(b);
  });
  it("approximates the requested percentage across many synthetic devices", () => {
    // Simulate 2000 devices by varying the storage-backed id.
    let enabled = 0;
    for (let i = 0; i < 2000; i++) {
      localStorage.setItem("rollout.device-id.v1", "dev-sim-" + i);
      if (isFeatureEnabled("cohort-test", 25)) enabled++;
    }
    const ratio = enabled / 2000;
    // Target 25%; allow a ±5 pp band to keep the test stable.
    expect(ratio).toBeGreaterThan(0.20);
    expect(ratio).toBeLessThan(0.30);
  });
});
