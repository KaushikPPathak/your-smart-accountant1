import { describe, expect, it } from "vitest";
import {
  acceptPairingOffer,
  createPairingOffer,
  generateDeviceId,
  generatePin,
  PAIRING_TTL_MS,
  PairingError,
} from "@/lib/sync/pairing";
import { generateCompanyKeyBytes } from "@/lib/sync/sync-crypto";

const CO = "co-1";
const PC = "pcdevice1";

describe("pairing", () => {
  it("hands the company key to the phone with the right PIN", async () => {
    const key = generateCompanyKeyBytes();
    const offer = await createPairingOffer({ companyId: CO, companyKey: key, pcDeviceId: PC, pin: "12345678" });
    const got = await acceptPairingOffer({ qrText: offer.qrText, pin: "12345678" });
    expect(got.companyId).toBe(CO);
    expect(got.pcDeviceId).toBe(PC);
    expect(got.companyKey).toEqual(key);
  }, 30_000);

  it("refuses the wrong PIN", async () => {
    const offer = await createPairingOffer({
      companyId: CO,
      companyKey: generateCompanyKeyBytes(),
      pcDeviceId: PC,
      pin: "12345678",
    });
    await expect(acceptPairingOffer({ qrText: offer.qrText, pin: "87654321" })).rejects.toThrow("Wrong PIN");
  }, 30_000);

  it("does not put the company key in the QR text", async () => {
    const key = generateCompanyKeyBytes();
    const offer = await createPairingOffer({ companyId: CO, companyKey: key, pcDeviceId: PC, pin: "12345678" });
    const b64 = btoa(String.fromCharCode(...key));
    expect(offer.qrText).not.toContain(b64);
  }, 30_000);

  it("refuses an expired offer", async () => {
    const t0 = 1_000_000;
    const offer = await createPairingOffer({
      companyId: CO,
      companyKey: generateCompanyKeyBytes(),
      pcDeviceId: PC,
      pin: "12345678",
      now: t0,
    });
    await expect(
      acceptPairingOffer({ qrText: offer.qrText, pin: "12345678", now: t0 + PAIRING_TTL_MS + 1 }),
    ).rejects.toThrow("expired");
  }, 30_000);

  it("rejects text that is not a pairing code", async () => {
    await expect(acceptPairingOffer({ qrText: "hello", pin: "12345678" })).rejects.toBeInstanceOf(PairingError);
  });

  it("rejects a PIN that is not 8 digits", async () => {
    await expect(
      createPairingOffer({ companyId: CO, companyKey: generateCompanyKeyBytes(), pcDeviceId: PC, pin: "1234" }),
    ).rejects.toThrow("8 digits");
  });

  it("makes 8-digit PINs and 8-character device ids", () => {
    expect(generatePin()).toMatch(/^\d{8}$/);
    expect(generateDeviceId()).toMatch(/^[a-z0-9]{8}$/);
  });
});
