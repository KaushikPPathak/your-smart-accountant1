import { describe, it, expect, beforeEach } from "vitest";
import { createDeviceLogin, hasDeviceLogin, resetDeviceLogin, verifyDeviceLogin } from "@/lib/device-login";

// Each hash runs 310,000 PBKDF2 rounds, so these tests need more than the default 5 s.
const SLOW = 30_000;

describe("computer sign-in", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("is created once and returns a recovery code", async () => {
    expect(hasDeviceLogin()).toBe(false);
    const code = await createDeviceLogin("secret12");
    expect(hasDeviceLogin()).toBe(true);
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(localStorage.getItem("ym_device_login")).not.toContain("secret12");
  }, SLOW);

  it("refuses a weak password at creation", async () => {
    await expect(createDeviceLogin("abc")).rejects.toThrow(/at least 8/);
    expect(hasDeviceLogin()).toBe(false);
  });

  it("accepts the right password and refuses a wrong one", async () => {
    await createDeviceLogin("secret12");
    expect(await verifyDeviceLogin("wrong123")).toBe(false);
    expect(await verifyDeviceLogin("secret12")).toBe(true);
  }, SLOW);

  it("a correct sign-in marks the launch as unlocked", async () => {
    await createDeviceLogin("secret12");
    sessionStorage.clear();
    expect(await verifyDeviceLogin("secret12")).toBe(true);
    expect(sessionStorage.getItem("ym_device_unlocked")).toBe("1");
  }, SLOW);

  it("the recovery code sets a new password and rotates the code", async () => {
    const code = await createDeviceLogin("secret12");
    const next = await resetDeviceLogin(code.toLowerCase().replace(/-/g, " "), "newpass99");
    expect(next).not.toBe(code);
    expect(await verifyDeviceLogin("newpass99")).toBe(true);
    expect(await verifyDeviceLogin("secret12")).toBe(false);
    await expect(resetDeviceLogin(code, "other999")).rejects.toThrow(/does not match/);
  }, SLOW);
});
