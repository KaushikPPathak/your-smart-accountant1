import { beforeEach, describe, expect, it } from "vitest";
import {
  clearVaultedToken,
  hasVaultedToken,
  loadVaultedToken,
  saveVaultedToken,
} from "@/lib/sync/onedrive-token-vault";
import type { KeyStore } from "@/lib/sync/sync-crypto";

function memoryKeyStore(): KeyStore {
  const data = new Map<string, Uint8Array>();
  return {
    get: async (id) => data.get(id) ?? null,
    set: async (id, k) => void data.set(id, k),
    delete: async (id) => void data.delete(id),
  };
}

describe("OneDrive token vault", () => {
  beforeEach(() => localStorage.clear());

  it("stores only ciphertext in local storage", async () => {
    const store = memoryKeyStore();
    await saveVaultedToken(store, { access_token: "SECRET-ACCESS-TOKEN", refresh_token: "SECRET-REFRESH", expires_at: 1 });
    const raw = localStorage.getItem("ym_sync_onedrive_vault") ?? "";
    expect(raw).not.toContain("SECRET-ACCESS-TOKEN");
    expect(raw).not.toContain("SECRET-REFRESH");
    expect(hasVaultedToken()).toBe(true);
  });

  it("round-trips the token with the same key", async () => {
    const store = memoryKeyStore();
    const tok = { access_token: "a", refresh_token: "r", expires_at: 123, account_label: "x@y" };
    await saveVaultedToken(store, tok);
    expect(await loadVaultedToken(store)).toEqual(tok);
  });

  it("cannot be read with a different key", async () => {
    await saveVaultedToken(memoryKeyStore(), { access_token: "a", expires_at: 1 });
    await expect(loadVaultedToken(memoryKeyStore())).rejects.toThrow("missing");
  });

  it("clears the token", async () => {
    await saveVaultedToken(memoryKeyStore(), { access_token: "a", expires_at: 1 });
    clearVaultedToken();
    expect(hasVaultedToken()).toBe(false);
  });
});
