import { describe, expect, it } from "vitest";
import { createMemoryFolder } from "@/lib/sync/cloud-folder";
import {
  buildRecoveryText,
  ensureRecoveryCopy,
  parseRecoveryText,
  recoveryFileName,
  RecoveryKeyError,
  restoreKeyFromCloud,
} from "@/lib/sync/recovery-key";
import type { KeyStore } from "@/lib/sync/sync-crypto";
import { generateCompanyKeyBytes } from "@/lib/sync/sync-crypto";

function memoryKeyStore(): KeyStore & { data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    get: async (id) => data.get(id) ?? null,
    set: async (id, k) => void data.set(id, k),
    delete: async (id) => void data.delete(id),
  };
}

describe("recovery key", () => {
  it("creates the recovery file once, with this device's company key", async () => {
    const folder = createMemoryFolder();
    const store = memoryKeyStore();
    const first = await ensureRecoveryCopy(folder, store, "co-1");
    expect(first.created).toBe(true);
    const again = await ensureRecoveryCopy(folder, store, "co-1");
    expect(again.created).toBe(false);
    const text = await folder.read(recoveryFileName("co-1"));
    expect(parseRecoveryText(text!, "co-1")).toEqual(store.data.get("co-1"));
  });

  it("restores the same key on a new device", async () => {
    const folder = createMemoryFolder();
    const oldDevice = memoryKeyStore();
    await ensureRecoveryCopy(folder, oldDevice, "co-1");
    const newDevice = memoryKeyStore();
    await restoreKeyFromCloud(folder, newDevice, "co-1");
    expect(newDevice.data.get("co-1")).toEqual(oldDevice.data.get("co-1"));
  });

  it("refuses a recovery file for another company", () => {
    const text = buildRecoveryText("co-1", generateCompanyKeyBytes());
    expect(() => parseRecoveryText(text, "co-2")).toThrow("different company");
  });

  it("refuses text that is not a recovery file", () => {
    expect(() => parseRecoveryText("hello", "co-1")).toThrow(RecoveryKeyError);
    expect(() => parseRecoveryText(JSON.stringify({ kind: "other" }), "co-1")).toThrow("not a recovery file");
  });

  it("refuses a key of the wrong length", () => {
    const text = JSON.stringify({ kind: "smartaccountant-recovery", v: 1, companyId: "co-1", key: "AAAA" });
    expect(() => parseRecoveryText(text, "co-1")).toThrow("invalid key");
  });

  it("fails clearly when there is no recovery file to restore from", async () => {
    await expect(restoreKeyFromCloud(createMemoryFolder(), memoryKeyStore(), "co-1")).rejects.toThrow("No recovery file");
  });

  it("rejects an invalid company id", () => {
    expect(() => recoveryFileName("co|1")).toThrow("Invalid company id");
  });
});
