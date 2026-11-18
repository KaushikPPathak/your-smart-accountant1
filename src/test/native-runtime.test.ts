import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNativeRuntime,
  hasNativeStorage,
  isAndroidRuntime,
  isAndroidTauri,
  isDesktopRuntime,
} from "@/lib/native-bridge";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WebView2";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

function setEnv(opts: { ua: string; tauri?: boolean; electron?: boolean }) {
  vi.stubGlobal("navigator", { userAgent: opts.ua });
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI__;
  delete w.yourMehtaji;
  if (opts.tauri) w.__TAURI_INTERNALS__ = {};
  if (opts.electron) w.yourMehtaji = { isDesktop: true };
}

afterEach(() => {
  vi.unstubAllGlobals();
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI__;
  delete w.yourMehtaji;
});

describe("runtime classification", () => {
  it("browser on Windows is not desktop and has no native storage", () => {
    setEnv({ ua: WINDOWS_UA });
    expect(getNativeRuntime()).toBe("browser");
    expect(isDesktopRuntime()).toBe(false);
    expect(hasNativeStorage()).toBe(false);
  });

  it("Windows Tauri is desktop and has native storage", () => {
    setEnv({ ua: WINDOWS_UA, tauri: true });
    expect(getNativeRuntime()).toBe("tauri");
    expect(isAndroidRuntime()).toBe(false);
    expect(isDesktopRuntime()).toBe(true);
    expect(hasNativeStorage()).toBe(true);
  });

  it("Electron is desktop and has native storage", () => {
    setEnv({ ua: WINDOWS_UA, electron: true });
    expect(getNativeRuntime()).toBe("electron");
    expect(isDesktopRuntime()).toBe(true);
    expect(hasNativeStorage()).toBe(true);
  });

  it("Android Tauri is not desktop but keeps native storage", () => {
    setEnv({ ua: ANDROID_UA, tauri: true });
    expect(getNativeRuntime()).toBe("tauri");
    expect(isAndroidRuntime()).toBe(true);
    expect(isDesktopRuntime()).toBe(false);
    expect(hasNativeStorage()).toBe(true);
  });

  it("Android browser is not desktop and has no native storage", () => {
    setEnv({ ua: ANDROID_UA });
    expect(isAndroidRuntime()).toBe(true);
    expect(isDesktopRuntime()).toBe(false);
    expect(hasNativeStorage()).toBe(false);
  });
});

describe("Android Tauri vs Android browser", () => {
  it("Android Tauri is Android and native", () => {
    setEnv({ ua: ANDROID_UA, tauri: true });
    expect(isAndroidTauri()).toBe(true);
  });

  it("ordinary Android Chrome is Android but not native Tauri", () => {
    setEnv({ ua: ANDROID_UA });
    expect(isAndroidRuntime()).toBe(true);
    expect(isAndroidTauri()).toBe(false);
    expect(hasNativeStorage()).toBe(false);
  });

  it("Windows Tauri is never Android Tauri", () => {
    setEnv({ ua: WINDOWS_UA, tauri: true });
    expect(isAndroidTauri()).toBe(false);
  });
});
