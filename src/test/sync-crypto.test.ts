import { describe, expect, it } from "vitest";
import {
  SyncCryptoError,
  decryptPacket,
  encryptPacket,
  fromBase64,
  generateCompanyKeyBytes,
  getOrCreateCompanyKey,
  packetAad,
  packetFromText,
  packetToText,
  type KeyStore,
} from "@/lib/sync/sync-crypto";

const text = (s: string) => new TextEncoder().encode(s);
const aad = (over: Partial<{ companyId: string; kind: string; sequence: number }> = {}) =>
  packetAad({ companyId: "co-1", kind: "outbox", sequence: 1, ...over });

describe("sync-crypto", () => {
  it("round-trips a payload", async () => {
    const key = generateCompanyKeyBytes();
    const packet = await encryptPacket(key, text("ledger: Cash, opening 1000"), aad());
    const out = await decryptPacket(key, packet, aad());
    expect(new TextDecoder().decode(out)).toBe("ledger: Cash, opening 1000");
  });

  it("never stores plaintext in the packet", async () => {
    const key = generateCompanyKeyBytes();
    const packet = await encryptPacket(key, text("SECRET-PARTY-NAME"), aad());
    expect(packetToText(packet)).not.toContain("SECRET-PARTY-NAME");
  });

  it("uses a fresh IV for each encryption of the same data", async () => {
    const key = generateCompanyKeyBytes();
    const a = await encryptPacket(key, text("same"), aad());
    const b = await encryptPacket(key, text("same"), aad());
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(fromBase64(a.iv).length).toBe(12);
  });

  it("fails with the wrong key", async () => {
    const packet = await encryptPacket(generateCompanyKeyBytes(), text("x"), aad());
    await expect(decryptPacket(generateCompanyKeyBytes(), packet, aad())).rejects.toBeInstanceOf(
      SyncCryptoError,
    );
  });

  it("fails if the packet is moved to another company", async () => {
    const key = generateCompanyKeyBytes();
    const packet = await encryptPacket(key, text("x"), aad({ companyId: "co-1" }));
    await expect(decryptPacket(key, packet, aad({ companyId: "co-2" }))).rejects.toThrow();
  });

  it("fails if the packet is replayed at another sequence number", async () => {
    const key = generateCompanyKeyBytes();
    const packet = await encryptPacket(key, text("x"), aad({ sequence: 5 }));
    await expect(decryptPacket(key, packet, aad({ sequence: 6 }))).rejects.toThrow();
  });

  it("fails if the ciphertext is altered", async () => {
    const key = generateCompanyKeyBytes();
    const packet = await encryptPacket(key, text("hello"), aad());
    const bytes = fromBase64(packet.ct);
    bytes[0] ^= 0x01;
    const tampered = { ...packet, ct: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptPacket(key, tampered, aad())).rejects.toThrow();
  });

  it("rejects keys that are not 256 bits", async () => {
    await expect(encryptPacket(new Uint8Array(16), text("x"), aad())).rejects.toThrow(
      "256 bits",
    );
  });

  it("parses only well-formed envelopes", () => {
    expect(() => packetFromText("not json")).toThrow(SyncCryptoError);
    expect(() => packetFromText(JSON.stringify({ v: 2, alg: "AES-256-GCM", iv: "", ct: "" }))).toThrow(
      SyncCryptoError,
    );
    expect(() => packetFromText(JSON.stringify({ v: 1, alg: "none", iv: "a", ct: "b" }))).toThrow(
      SyncCryptoError,
    );
  });

  it("rejects an invalid packet context", () => {
    expect(() => packetAad({ companyId: "", kind: "outbox", sequence: 0 })).toThrow(SyncCryptoError);
    expect(() => packetAad({ companyId: "co", kind: "outbox", sequence: -1 })).toThrow(SyncCryptoError);
  });

  it("creates a company key once and then reuses it", async () => {
    const data = new Map<string, Uint8Array>();
    const store: KeyStore = {
      get: async (id) => data.get(id) ?? null,
      set: async (id, k) => void data.set(id, k),
      delete: async (id) => void data.delete(id),
    };
    const first = await getOrCreateCompanyKey(store, "co-1");
    const second = await getOrCreateCompanyKey(store, "co-1");
    expect(second).toEqual(first);
    expect(first.length).toBe(32);
    const other = await getOrCreateCompanyKey(store, "co-2");
    expect(other).not.toEqual(first);
  });
});
