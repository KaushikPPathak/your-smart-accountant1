import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryFolder } from "@/lib/sync/cloud-folder";
import { getOrCreateDeviceId, startPhonePairing, turnOnSync } from "@/lib/sync/sync-setup";
import { acceptPairingOffer } from "@/lib/sync/pairing";
import type { KeyStore } from "@/lib/sync/sync-crypto";

function memoryKeyStore(): KeyStore & { data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    get: async (id) => data.get(id) ?? null,
    set: async (id, k) => void data.set(id, k),
    delete: async (id) => void data.delete(id),
  };
}

describe("sync setup", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the same device id across calls", () => {
    const a = getOrCreateDeviceId();
    expect(a).toMatch(/^[a-z0-9]{8}$/);
    expect(getOrCreateDeviceId()).toBe(a);
  });

  it("turns sync on once and saves the recovery copy", async () => {
    const folder = createMemoryFolder();
    const store = memoryKeyStore();
    expect((await turnOnSync(folder, store, "co-1")).recoveryCreated).toBe(true);
    expect((await turnOnSync(folder, store, "co-1")).recoveryCreated).toBe(false);
  });

  it("pairing offer hands the same company key to the phone", async () => {
    const store = memoryKeyStore();
    const offer = await startPhonePairing(store, "co-1", 1_000);
    const got = await acceptPairingOffer({ qrText: offer.qrText, pin: offer.pin, now: 1_000 });
    expect(got.companyKey).toEqual(store.data.get("co-1"));
    expect(got.pcDeviceId).toBe(offer.pcDeviceId);
  }, 30_000);
});
