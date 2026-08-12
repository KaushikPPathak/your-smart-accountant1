// Integrity manifest — per-company "last known good" fingerprint.
//
// Purpose: give auto-restore a trustworthy answer to "did this company
// really have N ledgers / M vouchers before?". Without this the app cannot
// tell "user started fresh" from "IndexedDB profile got orphaned".
//
// Storage:
//   1. IndexedDB `meta` table under key `integrity:<companyId>`  (fast, in-DB)
//   2. Mirrored to  <APPLOCALDATA>/state/integrity.json  on desktop (survives
//      even a full WebView profile wipe)
//
// The manifest is updated whenever a snapshot is successfully written to
// disk — that's the point at which we KNOW the data is durable. It is
// never written speculatively.

import { getMeta, setMeta, offlineDb } from "@/lib/offline/db";
import type { CompanyBackup } from "@/lib/backup";
import { isDesktopRuntime, writeAbsoluteFileNative, readAbsoluteTextFileNative } from "@/lib/native-bridge";
import { getAppPaths } from "@/lib/app-paths";

export interface IntegrityEntry {
  companyId: string;
  companyName: string;
  lastGoodAt: number;           // epoch ms
  ledgers: number;
  items: number;
  vouchers: number;
  voucherEntries: number;
  voucherItems: number;
  /** File name of the snapshot that produced this entry, if any. */
  lastSnapshotFile?: string | null;
  /** Sub-path relative to <root>, e.g. "snapshots/2026-07-06". */
  lastSnapshotDir?: string | null;
}

export type IntegrityMap = Record<string, IntegrityEntry>;

const METAKEY = (companyId: string) => `integrity:${companyId}`;
const MIRROR_FILE = "integrity.json";
const MIRROR_SUBDIR = "state";

function countFromPayload(name: string, companyId: string, payload: CompanyBackup, opts?: { file?: string; dir?: string }): IntegrityEntry {
  return {
    companyId,
    companyName: name,
    lastGoodAt: Date.now(),
    ledgers: payload.ledgers?.length ?? 0,
    items: payload.items?.length ?? 0,
    vouchers: payload.vouchers?.length ?? 0,
    voucherEntries: payload.voucher_entries?.length ?? 0,
    voucherItems: payload.voucher_items?.length ?? 0,
    lastSnapshotFile: opts?.file ?? null,
    lastSnapshotDir: opts?.dir ?? null,
  };
}

export function totalRows(e: Pick<IntegrityEntry, "ledgers" | "items" | "vouchers">): number {
  return (e.ledgers ?? 0) + (e.items ?? 0) + (e.vouchers ?? 0);
}

async function readMirror(): Promise<IntegrityMap> {
  if (!isDesktopRuntime()) return {};
  try {
    const paths = await getAppPaths();
    if (!paths) return {};
    const full = `${paths.state.replace(/[\\/]+$/, "")}/${MIRROR_FILE}`;
    const res = await readAbsoluteTextFileNative(full);
    if (!res.ok || !res.text) return {};
    const parsed = JSON.parse(res.text) as IntegrityMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

async function writeMirror(map: IntegrityMap): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    const paths = await getAppPaths();
    if (!paths) return;
    await writeAbsoluteFileNative(paths.root, MIRROR_SUBDIR, MIRROR_FILE, JSON.stringify(map, null, 2));
  } catch { /* ignore */ }
}

export async function recordIntegrityFromSnapshot(
  companyId: string,
  companyName: string,
  payload: CompanyBackup,
  snapshot?: { file?: string; dir?: string },
): Promise<IntegrityEntry> {
  const entry = countFromPayload(companyName, companyId, payload, snapshot);
  await setMeta(METAKEY(companyId), entry);
  const mirror = await readMirror();
  mirror[companyId] = entry;
  await writeMirror(mirror);
  return entry;
}

export async function getIntegrity(companyId: string): Promise<IntegrityEntry | null> {
  const fromDb = await getMeta<IntegrityEntry>(METAKEY(companyId));
  if (fromDb) return fromDb;
  // Fall back to the disk mirror — this is the whole point: if the WebView
  // profile was orphaned, IndexedDB is empty but the mirror survives.
  const mirror = await readMirror();
  const hit = mirror[companyId];
  if (hit) {
    // Rehydrate the DB copy so subsequent reads are fast.
    await setMeta(METAKEY(companyId), hit);
  }
  return hit ?? null;
}

export async function getAllIntegrity(): Promise<IntegrityMap> {
  const map: IntegrityMap = {};
  try {
    const rows = await offlineDb.meta.toArray();
    for (const r of rows as { key: string; value: unknown }[]) {
      if (typeof r.key === "string" && r.key.startsWith("integrity:")) {
        const v = r.value as IntegrityEntry;
        if (v && v.companyId) map[v.companyId] = v;
      }
    }
  } catch { /* ignore */ }
  // Overlay disk mirror (source of truth after profile loss).
  const mirror = await readMirror();
  for (const [k, v] of Object.entries(mirror)) {
    if (!map[k] || v.lastGoodAt > (map[k].lastGoodAt ?? 0)) map[k] = v;
  }
  return map;
}

export async function countLive(companyId: string): Promise<{ ledgers: number; items: number; vouchers: number }> {
  try {
    const [l, i, v] = await Promise.all([
      offlineDb.cache_ledgers.where("company_id").equals(companyId).count(),
      offlineDb.cache_items.where("company_id").equals(companyId).count(),
      offlineDb.cache_vouchers.where("company_id").equals(companyId).count(),
    ]);
    return { ledgers: Number(l) || 0, items: Number(i) || 0, vouchers: Number(v) || 0 };
  } catch {
    return { ledgers: 0, items: 0, vouchers: 0 };
  }
}
