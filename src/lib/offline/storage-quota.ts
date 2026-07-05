// Storage quota + persistence helpers.
//
// Browsers give each origin a limited slice of disk for IndexedDB. When the
// device runs low on space the browser MAY silently evict the whole origin —
// wiping the offline cache and any un-synced outbox rows. Two mitigations:
//
//   1. navigator.storage.persist() — asks the browser NOT to evict this
//      origin under storage pressure. Chrome grants it automatically for
//      installed PWAs; Safari extends its 7-day eviction window.
//   2. navigator.storage.estimate() — reports usage vs quota so we can
//      surface it on the Data Sync screen and warn before writes start
//      failing with QuotaExceededError.

export interface StorageQuota {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
  persisted: boolean;
  supported: boolean;
}

const EMPTY: StorageQuota = {
  usageBytes: 0,
  quotaBytes: 0,
  percentUsed: 0,
  persisted: false,
  supported: false,
};

/**
 * Request persistent storage. Idempotent and best-effort — some browsers
 * grant automatically, others prompt, iOS Safari usually declines but
 * still extends the eviction window. Safe to call on every app boot.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Current usage / quota / persisted state. Returns zeros on unsupported browsers. */
export async function getStorageQuota(): Promise<StorageQuota> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return EMPTY;
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ]);
    const usage = Number(estimate.usage ?? 0);
    const quota = Number(estimate.quota ?? 0);
    return {
      usageBytes: usage,
      quotaBytes: quota,
      percentUsed: quota > 0 ? (usage / quota) * 100 : 0,
      persisted: Boolean(persisted),
      supported: true,
    };
  } catch {
    return EMPTY;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
