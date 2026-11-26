import { describe, expect, it } from "vitest";
import { createKeychainKeyStore, KeychainUnavailableError } from "@/lib/sync/keychain-store";
import { generateCompanyKeyBytes } from "@/lib/sync/sync-crypto";

function fakeKeychain() {
  const data = new Map<string, string>();
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const invoke = (async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    const id = String(args.companyId);
    if (cmd === "sync_key_get") return data.get(id) ?? null;
    if (cmd === "sync_key_set") return void data.set(id, String(args.keyBase64));
    if (cmd === "sync_key_delete") return void data.delete(id);
    throw new Error("unknown command");
  }) as never;
  return { invoke, data, calls };
}

describe("keychain key store", () => {
  it("stores and reads back the same key bytes", async () => {
    const k = fakeKeychain();
    const store = createKeychainKeyStore(k.invoke);
    const key = generateCompanyKeyBytes();
    await store.set("co-1", key);
    expect(await store.get("co-1")).toEqual(key);
  });

  it("returns null for a company with no key", async () => {
    const store = createKeychainKeyStore(fakeKeychain().invoke);
    expect(await store.get("missing")).toBeNull();
  });

  it("deletes a key", async () => {
    const k = fakeKeychain();
    const store = createKeychainKeyStore(k.invoke);
    await store.set("co-1", generateCompanyKeyBytes());
    await store.delete("co-1");
    expect(await store.get("co-1")).toBeNull();
  });

  it("reports an unavailable keychain as a clear error, never falling back to plain storage", async () => {
    const failing = (async () => {
      throw new Error("Secure key storage is not available on this platform");
    }) as never;
    const store = createKeychainKeyStore(failing);
    await expect(store.set("co-1", generateCompanyKeyBytes())).rejects.toBeInstanceOf(
      KeychainUnavailableError,
    );
  });
});
