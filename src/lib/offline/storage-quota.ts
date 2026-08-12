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

// ---------------------------------------------------------------------------
// Global low-storage watcher
// ---------------------------------------------------------------------------
// Polls the browser storage estimate and surfaces a toast when the offline
// cache is close to its quota. If we cross the quota, IndexedDB writes start
// throwing QuotaExceededError and the app cannot save vouchers offline — we
// tell the user in plain language before that happens.

const WARN_PCT = 80;   // "getting full"
const CRIT_PCT = 92;   // "app will stop working"
const CHECK_MS = 60_000;

let watcherStarted = false;
let lastLevel: "ok" | "warn" | "crit" = "ok";
let lastToastAt = 0;

async function checkAndWarn() {
  const q = await getStorageQuota();
  if (!q.supported || q.quotaBytes === 0) return;

  const level: "ok" | "warn" | "crit" =
    q.percentUsed >= CRIT_PCT ? "crit" : q.percentUsed >= WARN_PCT ? "warn" : "ok";

  // Ask the browser again for persistence when we cross into warn/crit —
  // some browsers only grant it once usage is meaningful.
  if (level !== "ok" && !q.persisted) void requestPersistentStorage();

  if (level === "ok") { lastLevel = "ok"; return; }

  // Re-toast when level escalates, or every 30 min at the same level.
  const escalated = level !== lastLevel;
  const stale = Date.now() - lastToastAt > 30 * 60_000;
  if (!escalated && !stale) return;

  lastLevel = level;
  lastToastAt = Date.now();

  const free = Math.max(0, q.quotaBytes - q.usageBytes);
  const { toast } = await import("sonner");
  if (level === "crit") {
    toast.error("Device storage almost full", {
      description: `Only ${formatBytes(free)} left for offline data. The app will stop saving new entries unless you free up space on this device.`,
      duration: 15_000,
    });
  } else {
    toast.warning("Device storage getting full", {
      description: `${Math.round(q.percentUsed)}% used (${formatBytes(free)} free). Free up space soon or the app may stop working offline.`,
      duration: 10_000,
    });
  }
}

/** Start the background low-storage watcher. Idempotent. */
export function startStorageWatcher() {
  if (watcherStarted) return;
  if (typeof window === "undefined") return;
  watcherStarted = true;
  setTimeout(() => { void checkAndWarn(); }, 8_000);
  setInterval(() => { void checkAndWarn(); }, CHECK_MS);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkAndWarn();
  });
}
