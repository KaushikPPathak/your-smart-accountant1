// Per-launch de-duplication for heavy startup jobs (auto-restore, update
// safety). Several screens trigger the same job during boot; they now share
// one in-flight/settled promise instead of re-reading snapshot files.
const jobs = new Map<string, Promise<unknown>>();

export function runOncePerLaunch<T>(key: string, job: () => Promise<T>): Promise<T> {
  let p = jobs.get(key) as Promise<T> | undefined;
  if (!p) {
    p = job();
    jobs.set(key, p);
    // A failed run may be retried later in the same launch.
    p.catch(() => jobs.delete(key));
  }
  return p;
}

const DISCOVERY_KEY = "ym:snapshot-discovery-last";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Snapshot folder scan for installs that already have companies: once a day. */
export function snapshotDiscoveryDue(): boolean {
  try {
    const last = Number(localStorage.getItem(DISCOVERY_KEY) ?? 0);
    return !Number.isFinite(last) || Date.now() - last > DAY_MS;
  } catch {
    return true;
  }
}

export function markSnapshotDiscoveryDone(): void {
  try { localStorage.setItem(DISCOVERY_KEY, String(Date.now())); } catch { /* ignore */ }
}
