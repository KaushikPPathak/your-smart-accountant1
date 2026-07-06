// Backup policy — industry-standard rules for accounting data exports.
// References:
// - Income-tax Act, 1961 (India), §44AA & Rule 6F — books to be preserved 6 yrs;
//   §149 reassessment window — effective 8 yrs of safe-keeping recommended.
// - CGST Act, 2017 §36 — records preserved 72 months (6 yrs) from due date of
//   annual return.
// - Companies Act, 2013 §128(5) — books for not less than 8 financial years.
// - ISO/IEC 27040 & NIST SP 800-34 — "3-2-1" rule for backups.

export const BACKUP_POLICY = {
  /** Take a fresh backup at least this often. */
  recommendedFrequencyDays: 7,
  /** Take a manual backup before any of these events. */
  mandatoryBeforeEvents: [
    "Year-end closure",
    "Bulk import (Tally / Busy / Excel)",
    "Restore from another backup",
    "Mass-delete / Verify-and-repair",
    "Software upgrade",
  ],
  /**
   * Retention: local snapshots and backups are kept FOREVER on the user's
   * device. The app never deletes user data automatically — no day count,
   * no rotation, no configuration switch turns this off. Only the user can
   * remove a backup file, by deleting it from disk themselves.
   *
   * The counts below are only *recommendations* shown in the UI so users
   * know how many copies they should keep OFFSITE (USB / cloud) under the
   * industry 3-2-1 rule. They are not enforced against local storage.
   */
  retention: {
    daily: "forever" as const,
    weekly: "forever" as const,
    monthly: "forever" as const,
    yearly: "forever" as const,
    /** Statutory minimum (Income-tax + Companies Act) — for user awareness only. */
    minimumMonths: 96, // 8 financial years
    /** Suggested offsite copies for the user's own backup rotation. */
    suggestedOffsite: { daily: 7, weekly: 4, monthly: 12 },
  },

  /** 3-2-1 rule. */
  copies: {
    count: 3,
    media: 2,        // e.g. local disk + external HDD / USB
    offsite: 1,      // cloud, bank locker, other premises
  },
  /** Integrity — SHA-256 checksum embedded in every backup file. */
  integrity: {
    algorithm: "SHA-256" as const,
    verifyOnRestore: true,
  },
  /** File naming convention used by exportCompanyBackup. */
  naming: "<Company>_backup_<YYYY-MM-DDTHH-MM-SS>.json",
  /** Test restore at least once per quarter on a scratch company. */
  testRestoreFrequencyDays: 90,
} as const;

/** SHA-256 of a UTF-8 string, hex-lowercase. Uses WebCrypto (available in
 *  browsers, Electron renderer and the Worker SSR runtime). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface BackupEnvelope<T> {
  /** Wrapper version — bumped if the envelope shape changes. */
  envelope_version: 1;
  product: "YourMehtaji";
  app_version: string;
  created_at: string;
  /** SHA-256 of the canonical JSON of `payload`. Verified on restore. */
  checksum_sha256: string;
  policy: typeof BACKUP_POLICY;
  payload: T;
}

export async function wrapBackup<T>(payload: T, appVersion = "1.0.0"): Promise<BackupEnvelope<T>> {
  const canonical = JSON.stringify(payload);
  const checksum = await sha256Hex(canonical);
  return {
    envelope_version: 1,
    product: "YourMehtaji",
    app_version: appVersion,
    created_at: new Date().toISOString(),
    checksum_sha256: checksum,
    policy: BACKUP_POLICY,
    payload,
  };
}

export async function verifyEnvelope<T>(env: BackupEnvelope<T>): Promise<boolean> {
  if (env.envelope_version !== 1) return false;
  const expected = await sha256Hex(JSON.stringify(env.payload));
  return expected === env.checksum_sha256;
}

/** Type-guard: did the .json file come wrapped in an envelope? */
export function isBackupEnvelope(j: unknown): j is BackupEnvelope<unknown> {
  return (
    typeof j === "object" && j !== null &&
    (j as { envelope_version?: unknown }).envelope_version === 1 &&
    typeof (j as { checksum_sha256?: unknown }).checksum_sha256 === "string" &&
    "payload" in (j as object)
  );
}
