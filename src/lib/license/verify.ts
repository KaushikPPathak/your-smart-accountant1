// Ed25519 offline license verifier.
//
// A license key is a single opaque string of the form:
//   SMAC-<PLAN>-<base64url(payloadJson)>.<base64url(signature)>
//
// The payload is:
//   {
//     n:  string,   // customer name
//     e:  string,   // customer email
//     d:  number,   // max devices
//     p:  "basic"|"pro"|"lifetime",
//     x?: string,   // ISO date, omitted for lifetime
//     id: string    // license id
//   }
//
// The signature covers the raw base64url(payload) bytes and is produced by
// the private key held by the seller (see tools/license-mint/mint.ts).
// The public key is baked in at build time via src/lib/license/public-key.ts.

import * as ed from "@noble/ed25519";
import { LICENSE_PUBLIC_KEY_HEX } from "./public-key";

export type Plan = "basic" | "pro" | "lifetime";

export interface LicensePayload {
  n: string;
  e: string;
  d: number;
  p: Plan;
  x?: string;
  id: string;
}

export interface VerifyOk {
  ok: true;
  payload: LicensePayload;
  expiresAt: Date | null;
  plan: Plan;
}
export interface VerifyErr {
  ok: false;
  reason: "malformed" | "bad_signature" | "no_public_key" | "expired";
}
export type VerifyResult = VerifyOk | VerifyErr;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function verifyLicenseKey(rawKey: string): Promise<VerifyResult> {
  if (!LICENSE_PUBLIC_KEY_HEX) return { ok: false, reason: "no_public_key" };
  const key = rawKey.trim();
  const m = /^SMAC-(BASIC|PRO|LIFETIME)-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(key);
  if (!m) return { ok: false, reason: "malformed" };
  const [, , payloadB64, sigB64] = m;

  let payload: LicensePayload;
  try {
    const jsonBytes = b64urlToBytes(payloadB64);
    payload = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object" || !payload.p || !payload.id) {
    return { ok: false, reason: "malformed" };
  }

  const msg = new TextEncoder().encode(payloadB64);
  const sig = b64urlToBytes(sigB64);
  const pub = hexToBytes(LICENSE_PUBLIC_KEY_HEX);
  let good = false;
  try {
    good = await ed.verifyAsync(sig, msg, pub);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "bad_signature" };

  let expiresAt: Date | null = null;
  if (payload.p !== "lifetime" && payload.x) {
    expiresAt = new Date(payload.x + "T23:59:59");
    if (Date.now() > expiresAt.getTime()) return { ok: false, reason: "expired" };
  }

  return { ok: true, payload, expiresAt, plan: payload.p };
}
