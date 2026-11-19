import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyLicenseKey } = vi.hoisted(() => ({ verifyLicenseKey: vi.fn() }));
vi.mock("@/lib/license/verify", () => ({ verifyLicenseKey }));

import { tryGetMachineId, getMachineIdShort } from "@/lib/license/machine-id";
import { activateLicenseKey } from "@/lib/license/state";

const KEY_LIC = "sm.license.v1";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  };
}

function blockedStorage() {
  const fail = () => { throw new Error("storage blocked"); };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 };
}

const validResult = (id: string, d: number) => ({
  ok: true,
  plan: "annual",
  expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
  payload: { id, d, n: "Test Customer", e: "buyer@example.com" },
});

beforeEach(() => {
  verifyLicenseKey.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("machine id without storage", () => {
  it("returns null when localStorage throws, not a shared constant", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    expect(tryGetMachineId()).toBeNull();
  });

  it("two devices with blocked storage do not share an identity", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    const a = tryGetMachineId();
    const b = tryGetMachineId();
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(getMachineIdShort()).toBe("unavailable");
  });

  it("a stable id is created and reused when storage works", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const first = tryGetMachineId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(tryGetMachineId()).toBe(first);
  });
});

describe("license activation", () => {
  it("refuses with storage_unavailable when the device has no usable storage", async () => {
    vi.stubGlobal("localStorage", blockedStorage());
    verifyLicenseKey.mockResolvedValue(validResult("L1", 1));
    const res = await activateLicenseKey("KEY-1");
    expect(res).toEqual({ ok: false, reason: "storage_unavailable" });
  });

  it("activates and reports licensed when storage works", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    verifyLicenseKey.mockResolvedValue(validResult("L1", 1));
    const res = await activateLicenseKey("KEY-1");
    expect(res.ok).toBe(true);
    expect(res.state?.mode).toBe("licensed");
    expect(res.state?.deviceCount).toBe(1);
  });

  it("the second device on a one-seat key is refused with device_limit_reached", async () => {
    const deviceA = memoryStorage();
    vi.stubGlobal("localStorage", deviceA);
    verifyLicenseKey.mockResolvedValue(validResult("L1", 1));
    expect((await activateLicenseKey("KEY-1")).ok).toBe(true);

    // Copy the saved license to a second device that has its own machine id.
    const deviceB = memoryStorage();
    deviceB.setItem(KEY_LIC, deviceA.getItem(KEY_LIC) as string);
    vi.stubGlobal("localStorage", deviceB);
    const res = await activateLicenseKey("KEY-1");
    expect(res).toEqual({ ok: false, reason: "device_limit_reached" });
  });
});
