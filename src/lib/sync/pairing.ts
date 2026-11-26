// Pairing: moves a company key from the PC to the phone without the cloud ever
// seeing it.
//
// The PC shows a QR code and an 8-digit PIN. The QR carries the company key
// encrypted with a key derived from the PIN (PBKDF2-SHA256, 600,000 rounds,
// per-offer salt). A photo of the QR alone is useless without the PIN. The
// offer expires after 5 minutes. The camera scanner and the on-screen display
// are separate UI pieces; this module is only the logic.

import {
  decryptPacket,
  encryptPacket,
  packetAad,
  packetFromText,
  packetToText,
  SyncCryptoError,
  fromBase64,
  toBase64,
} from "@/lib/sync/sync-crypto";

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const PBKDF2_ROUNDS = 600_000;
const PIN_DIGITS = 8;
const DEVICE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingError";
  }
}

export interface PairingOffer {
  pin: string;
  qrText: string;
  expiresAt: number;
}

interface QrPayload {
  v: 1;
  companyId: string;
  pcDeviceId: string;
  expiresAt: number;
  salt: string;
  packet: ReturnType<typeof packetFromText>;
}

/** Random 8-digit PIN. Uses crypto randomness, not Math.random. */
export function generatePin(): string {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return String(buf[0] % 10 ** PIN_DIGITS).padStart(PIN_DIGITS, "0");
}

/** Random 8-character device id for a new device. */
export function generateDeviceId(): string {
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => DEVICE_ALPHABET[b % DEVICE_ALPHABET.length]).join("");
}

async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const base = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations: PBKDF2_ROUNDS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

function aadFor(companyId: string, pcDeviceId: string, expiresAt: number): Uint8Array<ArrayBuffer> {
  return packetAad({ companyId, kind: `pair:${pcDeviceId}:${expiresAt}`, sequence: 0 });
}

/** PC side: create the offer to show on screen. */
export async function createPairingOffer(args: {
  companyId: string;
  companyKey: Uint8Array;
  pcDeviceId: string;
  now?: number;
  pin?: string;
}): Promise<PairingOffer> {
  const now = args.now ?? Date.now();
  const pin = args.pin ?? generatePin();
  if (!/^\d{8}$/.test(pin)) throw new PairingError("PIN must be 8 digits");
  const expiresAt = now + PAIRING_TTL_MS;
  const salt = new Uint8Array(new ArrayBuffer(16));
  globalThis.crypto.getRandomValues(salt);
  const wrapKey = await deriveKeyFromPin(pin, salt);
  const packet = await encryptPacket(
    wrapKey,
    args.companyKey,
    aadFor(args.companyId, args.pcDeviceId, expiresAt),
  );
  const payload: QrPayload = {
    v: 1,
    companyId: args.companyId,
    pcDeviceId: args.pcDeviceId,
    expiresAt,
    salt: toBase64(salt),
    packet,
  };
  return { pin, qrText: JSON.stringify(payload), expiresAt };
}

/** Phone side: read the QR and the PIN, and return the company key. */
export async function acceptPairingOffer(args: {
  qrText: string;
  pin: string;
  now?: number;
}): Promise<{ companyId: string; pcDeviceId: string; companyKey: Uint8Array }> {
  const now = args.now ?? Date.now();
  let payload: QrPayload;
  try {
    payload = JSON.parse(args.qrText) as QrPayload;
  } catch {
    throw new PairingError("This QR code is not a pairing code");
  }
  if (payload.v !== 1 || typeof payload.companyId !== "string" || typeof payload.pcDeviceId !== "string") {
    throw new PairingError("This QR code is not a pairing code");
  }
  if (now > payload.expiresAt) throw new PairingError("This pairing code has expired. Make a new one on the PC.");
  if (!/^\d{8}$/.test(args.pin)) throw new PairingError("PIN must be 8 digits");
  const wrapKey = await deriveKeyFromPin(args.pin, fromBase64(payload.salt));
  try {
    const key = await decryptPacket(
      wrapKey,
      packetFromText(packetToText(payload.packet)),
      aadFor(payload.companyId, payload.pcDeviceId, payload.expiresAt),
    );
    return { companyId: payload.companyId, pcDeviceId: payload.pcDeviceId, companyKey: key };
  } catch (e) {
    if (e instanceof SyncCryptoError) throw new PairingError("Wrong PIN");
    throw e;
  }
}
