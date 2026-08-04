// UPI payment QR helpers — local-only. The payee VPA and merchant name are
// stored per company on this device (never sent to our servers), matching the
// app's local-data ownership rule.

export interface UpiSettings {
  /** Payee address / VPA — the `pa` parameter. */
  pa: string;
  /** Payee (business/merchant) name — the `pn` parameter. */
  pn: string;
  /** Show the QR block on printed invoices too. */
  printOnInvoice: boolean;
}

const KEY = (companyId: string) => `ym_upi_${companyId}`;

export const emptyUpiSettings: UpiSettings = { pa: "", pn: "", printOnInvoice: true };

export function loadUpiSettings(companyId: string | null | undefined): UpiSettings {
  if (!companyId || typeof window === "undefined") return { ...emptyUpiSettings };
  try {
    const raw = window.localStorage.getItem(KEY(companyId));
    if (!raw) return { ...emptyUpiSettings };
    const parsed = JSON.parse(raw) as Partial<UpiSettings>;
    return {
      pa: typeof parsed.pa === "string" ? parsed.pa : "",
      pn: typeof parsed.pn === "string" ? parsed.pn : "",
      printOnInvoice: parsed.printOnInvoice !== false,
    };
  } catch {
    return { ...emptyUpiSettings };
  }
}

export function saveUpiSettings(companyId: string, s: UpiSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY(companyId), JSON.stringify(s));
}

/** A VPA looks like name@bank — letters, digits, dot, hyphen, underscore. */
export function isValidVpa(pa: string): boolean {
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$/.test(pa.trim());
}

export function validateUpiSettings(s: UpiSettings): string | null {
  const pa = s.pa.trim();
  const pn = s.pn.trim();
  if (!pa) return "Enter your UPI ID";
  if (!isValidVpa(pa)) return "UPI ID must look like name@bank";
  if (!pn) return "Enter the business / merchant name";
  if (pn.length > 50) return "Merchant name must be 50 characters or less";
  return null;
}

/** Merchant names in the UPI spec allow only plain text; strip separators. */
const cleanName = (n: string) => n.replace(/[&=?#]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);

export interface UpiUriInput {
  pa: string;
  pn: string;
  /** Amount in paise; omitted/zero produces an "enter amount" QR. */
  amountPaise?: number;
  /** Transaction note, e.g. invoice number. */
  note?: string;
  /** Transaction reference, e.g. voucher number. */
  ref?: string;
}

/** Build the standard `upi://pay?...` string (NPCI UPI Linking Specification). */
export function buildUpiUri({ pa, pn, amountPaise, note, ref }: UpiUriInput): string {
  const params = new URLSearchParams();
  params.set("pa", pa.trim());
  params.set("pn", cleanName(pn));
  if (ref) params.set("tr", ref.replace(/[^A-Za-z0-9-]/g, "").slice(0, 35));
  if (note) params.set("tn", cleanName(note));
  if (amountPaise && amountPaise > 0) params.set("am", (amountPaise / 100).toFixed(2));
  params.set("cu", "INR");
  return `upi://pay?${params.toString()}`;
}

/** PNG data URL for a UPI string — rendered locally, no network calls. */
export async function upiQrDataUrl(uri: string, size = 220): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(uri, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
