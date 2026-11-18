// Backup export must pick the right save path per runtime:
//   Android Tauri  → keep safety copy in app storage, then Android share sheet
//   Android browser (Chrome) → ordinary browser download (no native calls)
//   Windows Tauri  → native save (unchanged)
//   Plain browser  → ordinary browser download
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local-only-mode", () => ({ isLocalOnlyMode: () => true }));

const { saveCompanyFileNative, shareFilesAndroid } = vi.hoisted(() => ({
  saveCompanyFileNative: vi.fn(async (_c: string, _k: string, name: string) => ({
    ok: true,
    path: `C:/Data/${name}`,
  })),
  shareFilesAndroid: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/native-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native-bridge")>();
  return { ...actual, saveCompanyFileNative, shareFilesAndroid };
});

import { exportAllCompaniesBackup, exportCompanyBackup } from "@/lib/backup";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WebView2";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

function setEnv(ua: string, tauri: boolean) {
  vi.stubGlobal("navigator", { userAgent: ua });
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  if (tauri) w.__TAURI_INTERNALS__ = {};
}

let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saveCompanyFileNative.mockClear();
  shareFilesAndroid.mockClear();
  createObjectURL = vi.fn(() => "blob:test");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  // Node test environment: stub the minimal DOM that browserDownload uses.
  vi.stubGlobal("document", {
    createElement: () => ({ click: vi.fn(), href: "", download: "" }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("single-company backup export", () => {
  it("Android Tauri: safety copy in app storage and Android share sheet", async () => {
    setEnv(ANDROID_UA, true);
    const r = await exportCompanyBackup("co-1", "Acme");
    expect(saveCompanyFileNative).toHaveBeenCalledTimes(1);
    expect(shareFilesAndroid).toHaveBeenCalledTimes(1);
    expect(r.androidShared).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("Android browser: ordinary browser download, no native save or share", async () => {
    setEnv(ANDROID_UA, false);
    const r = await exportCompanyBackup("co-1", "Acme");
    expect(saveCompanyFileNative).not.toHaveBeenCalled();
    expect(shareFilesAndroid).not.toHaveBeenCalled();
    expect(r.androidShared).toBeUndefined();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("Windows Tauri: native save, never the Android share sheet", async () => {
    setEnv(WINDOWS_UA, true);
    const r = await exportCompanyBackup("co-1", "Acme");
    expect(saveCompanyFileNative).toHaveBeenCalledTimes(1);
    expect(shareFilesAndroid).not.toHaveBeenCalled();
    expect(r.desktopPath).toContain("Acme_backup_");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("plain browser on Windows: browser download fallback", async () => {
    setEnv(WINDOWS_UA, false);
    const r = await exportCompanyBackup("co-1", "Acme");
    expect(saveCompanyFileNative).not.toHaveBeenCalled();
    expect(r.desktopPath).toBeUndefined();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("all-company backup export", () => {
  it("Android Tauri: shares the all-company file", async () => {
    setEnv(ANDROID_UA, true);
    const r = await exportAllCompaniesBackup([{ id: "co-1", name: "Acme" }]);
    expect(saveCompanyFileNative).toHaveBeenCalledTimes(1);
    expect(shareFilesAndroid).toHaveBeenCalledTimes(1);
    expect(r.androidShared).toBe(true);
  });

  it("Android browser: browser download, no native calls", async () => {
    setEnv(ANDROID_UA, false);
    const r = await exportAllCompaniesBackup([{ id: "co-1", name: "Acme" }]);
    expect(saveCompanyFileNative).not.toHaveBeenCalled();
    expect(shareFilesAndroid).not.toHaveBeenCalled();
    expect(r.androidShared).toBeUndefined();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("Windows Tauri: native save path preserved", async () => {
    setEnv(WINDOWS_UA, true);
    const r = await exportAllCompaniesBackup([{ id: "co-1", name: "Acme" }]);
    expect(saveCompanyFileNative).toHaveBeenCalledTimes(1);
    expect(shareFilesAndroid).not.toHaveBeenCalled();
    expect(r.desktopPath).toBeDefined();
  });
});
