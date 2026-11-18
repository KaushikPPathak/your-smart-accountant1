// Report/export saving on Android: the file goes to Downloads and the user is
// offered Open / Share in a toast (no "Open location" on a phone). Windows keeps
// its existing desktop actions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccess, saveCompanyFileNative, saveToDownloadsAndroid, openFileAndroid, shareFilesAndroid, showInFolderNative, androidFlag } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  saveCompanyFileNative: vi.fn(async () => ({ ok: true, path: "/data/app/files/Acme/Reports/GST.pdf" })),
  saveToDownloadsAndroid: vi.fn(async () => ({ ok: true, displayPath: "Downloads/Your Mehtaji/Acme/Reports/GST.pdf" })),
  openFileAndroid: vi.fn(async () => ({ ok: true })),
  shareFilesAndroid: vi.fn(async () => ({ ok: true })),
  showInFolderNative: vi.fn(),
  androidFlag: { on: true },
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/lib/native-bridge", () => ({
  hasNativeStorage: () => true,
  isAndroidTauri: () => androidFlag.on,
  saveCompanyFileNative,
  saveToDownloadsAndroid,
  openFileAndroid,
  shareFilesAndroid,
  showInFolderNative,
  openPathNative: vi.fn(),
}));

import { saveExport } from "@/lib/desktop-save";

const opts = { subFolder: "Reports", fileName: "GST.pdf", contents: "x", mime: "application/pdf", toastTitle: "GST report" };

beforeEach(() => {
  toastSuccess.mockClear();
  saveCompanyFileNative.mockClear();
  saveToDownloadsAndroid.mockClear();
  showInFolderNative.mockClear();
  androidFlag.on = true;
  vi.stubGlobal("localStorage", { getItem: () => "Acme", setItem: vi.fn() });
  vi.stubGlobal("window", { localStorage: { getItem: () => "Acme" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveExport on Android", () => {
  it("copies the export to Downloads and offers Open and Share", async () => {
    const path = await saveExport(opts);
    expect(saveToDownloadsAndroid).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "/data/app/files/Acme/Reports/GST.pdf", fileName: "GST.pdf", mime: "application/pdf" }),
    );
    expect(path).toBe("Downloads/Your Mehtaji/Acme/Reports/GST.pdf");
    const [title, options] = toastSuccess.mock.calls[0] as [string, { description: string; action: { label: string; onClick: () => void }; cancel: { label: string; onClick: () => void } }];
    expect(title).toBe("GST report");
    expect(options.description).toContain("Files app");
    expect(options.action.label).toBe("Open");
    expect(options.cancel.label).toBe("Share");
    options.action.onClick();
    expect(openFileAndroid).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/data/app/files/Acme/Reports/GST.pdf", mime: "application/pdf" }));
    options.cancel.onClick();
    expect(shareFilesAndroid).toHaveBeenCalledWith(expect.objectContaining({ paths: ["/data/app/files/Acme/Reports/GST.pdf"], names: ["GST.pdf"] }));
    expect(showInFolderNative).not.toHaveBeenCalled();
  });

  it("still tells the user where the copy is when the Downloads copy fails", async () => {
    saveToDownloadsAndroid.mockResolvedValueOnce({ ok: false, error: "Needs Android 10" } as never);
    await saveExport(opts);
    const [, options] = toastSuccess.mock.calls[0] as [string, { description: string }];
    expect(options.description).toContain("Saved in the app");
  });

  it("Windows keeps the desktop Open Location action", async () => {
    androidFlag.on = false;
    saveCompanyFileNative.mockResolvedValueOnce({ ok: true, path: "C:\\Data\\Acme\\Reports\\GST.pdf" });
    await saveExport(opts);
    expect(saveToDownloadsAndroid).not.toHaveBeenCalled();
    const [, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string } }];
    expect(options.action.label).toBe("Open Location");
  });
});
