import { describe, it, expect, vi, afterEach } from "vitest";

const invoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("closeNativeApp (desktop)", () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    invoke.mockClear();
  });

  it("asks the desktop shell to end the whole app", async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const { closeNativeApp } = await import("@/lib/native-bridge");
    const res = await closeNativeApp();
    expect(invoke).toHaveBeenCalledWith("exit_app");
    expect(res.ok).toBe(true);
  });

  it("reports no native runtime in a plain browser", async () => {
    const { closeNativeApp } = await import("@/lib/native-bridge");
    const res = await closeNativeApp();
    expect(invoke).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});
