// End-to-end encryption for sync packets and encrypted backup files.
//
// One AES-256-GCM key per company. The key is generated on the first device,
// kept in the OS keychain (via KeyStore), and moved to other devices only
// during pairing. Nothing here talks to the network.
//
// Each packet is bound to its context through additional authenticated data
// (AAD): company id, packet kind and sequence number. A packet copied to
// another company or another position in the sequence fails to decrypt.

export const PACKET_VERSION = 1;
export const PACKET_ALG = "AES-256-GCM" as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedPacket {
  v: typeof PACKET_VERSION;
  alg: typeof PACKET_ALG;
  iv: string; // base64, 12 bytes
  ct: string; // base64, ciphertext including the 16-byte GCM tag
}

/** Where a company's raw key is kept on this device (OS keychain in production). */
export interface KeyStore {
  get(companyId: string): Promise<Uint8Array | null>;
  set(companyId: string, rawKey: Uint8Array): Promise<void>;
  delete(companyId: string): Promise<void>;
}

export class SyncCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncCryptoError";
  }
}

type Buf = Uint8Array<ArrayBuffer>;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SyncCryptoError("Web Crypto is not available on this device");
  return s;
}

/** Copy any byte array into an ArrayBuffer-backed array that Web Crypto accepts. */
function buf(bytes: Uint8Array): Buf {
  return new Uint8Array(bytes);
}

function randomBytes(n: number): Buf {
  const b = new Uint8Array(new ArrayBuffer(n));
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(text: string): Buf {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Generate a new random 256-bit company key as raw bytes. */
export function generateCompanyKeyBytes(): Buf {
  return randomBytes(KEY_BYTES);
}

async function importKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (rawKey.length !== KEY_BYTES) {
    throw new SyncCryptoError("Company key must be 256 bits");
  }
  return subtle().importKey("raw", buf(rawKey), { name: "AES-GCM" }, false, usages);
}

/** Build the AAD bytes that bind a packet to its context. */
export function packetAad(parts: { companyId: string; kind: string; sequence: number }): Buf {
  if (!parts.companyId || !parts.kind || !Number.isInteger(parts.sequence) || parts.sequence < 0) {
    throw new SyncCryptoError("Invalid packet context");
  }
  return buf(
    new TextEncoder().encode(
      `smartaccountant|v${PACKET_VERSION}|${parts.companyId}|${parts.kind}|${parts.sequence}`,
    ),
  );
}

/** Encrypt a plaintext payload with the company key. A fresh random IV is used for every call. */
export async function encryptPacket(
  rawKey: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<EncryptedPacket> {
  const key = await importKey(rawKey, ["encrypt"]);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv, additionalData: buf(aad) }, key, buf(plaintext)),
  );
  return { v: PACKET_VERSION, alg: PACKET_ALG, iv: toBase64(iv), ct: toBase64(ct) };
}

/** Decrypt a packet. Throws SyncCryptoError if the key, AAD or data is wrong. */
export async function decryptPacket(
  rawKey: Uint8Array,
  packet: EncryptedPacket,
  aad: Uint8Array,
): Promise<Buf> {
  if (packet.v !== PACKET_VERSION || packet.alg !== PACKET_ALG) {
    throw new SyncCryptoError("Unsupported packet version");
  }
  const key = await importKey(rawKey, ["decrypt"]);
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: buf(fromBase64(packet.iv)), additionalData: buf(aad) },
      key,
      buf(fromBase64(packet.ct)),
    );
    return new Uint8Array(pt);
  } catch {
    throw new SyncCryptoError("Packet could not be decrypted with this key");
  }
}

/** Serialise a packet to the text stored in a file. */
export function packetToText(packet: EncryptedPacket): string {
  return JSON.stringify(packet);
}

/** Parse packet text. Rejects anything that is not a valid packet envelope. */
export function packetFromText(text: string): EncryptedPacket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyncCryptoError("Packet is not valid JSON");
  }
  const p = parsed as Partial<EncryptedPacket>;
  if (
    !p ||
    p.v !== PACKET_VERSION ||
    p.alg !== PACKET_ALG ||
    typeof p.iv !== "string" ||
    typeof p.ct !== "string"
  ) {
    throw new SyncCryptoError("Packet envelope is malformed");
  }
  return p as EncryptedPacket;
}

/** Get the company key from the keychain, or create and store one on first use. */
export async function getOrCreateCompanyKey(store: KeyStore, companyId: string): Promise<Uint8Array> {
  const existing = await store.get(companyId);
  if (existing) return existing;
  const fresh = generateCompanyKeyBytes();
  await store.set(companyId, fresh);
  return fresh;
}
