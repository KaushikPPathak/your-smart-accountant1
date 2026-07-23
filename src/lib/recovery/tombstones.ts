// Deleted-company tombstones.
//
// When the user purges a company we remember its id + normalized name so
// that:
//   • auto-restore never resurrects it from an on-disk safety snapshot,
//   • the company picker filters it out even if a stale cache row slips
//     back in from a background reconcile.
//
// Tombstones live in the local `meta` table under a single key. They are
// permanent by design (matches the "local data is permanent" project
// rule): the user explicitly asked for the company to disappear.

import { getMeta, setMeta } from "@/lib/offline/db";

const KEY = "purged_companies";

export interface CompanyTombstone {
  companyId: string;
  normalizedName: string;
  purgedAtIso: string;
}

export function normalizeCompanyName(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getTombstones(): Promise<CompanyTombstone[]> {
  const raw = (await getMeta<CompanyTombstone[]>(KEY)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

export async function addTombstone(companyId: string, companyName: string): Promise<void> {
  const list = await getTombstones();
  const normalized = normalizeCompanyName(companyName);
  const next = list.filter((t) => t.companyId !== companyId);
  next.push({ companyId, normalizedName: normalized, purgedAtIso: new Date().toISOString() });
  await setMeta(KEY, next);
}

export async function isTombstoned(companyId: string, companyName?: string | null): Promise<boolean> {
  const list = await getTombstones();
  if (list.some((t) => t.companyId === companyId)) return true;
  if (companyName) {
    const n = normalizeCompanyName(companyName);
    if (n && list.some((t) => t.normalizedName === n)) return true;
  }
  return false;
}

export async function filterTombstoned<T extends { id?: string; company_id?: string; name?: string; companies?: { name?: string } }>(
  rows: T[],
): Promise<T[]> {
  const list = await getTombstones();
  if (list.length === 0) return rows;
  const ids = new Set(list.map((t) => t.companyId));
  const names = new Set(list.map((t) => t.normalizedName).filter(Boolean));
  return rows.filter((r) => {
    const id = String(r.id ?? r.company_id ?? "");
    if (id && ids.has(id)) return false;
    const name = normalizeCompanyName(r.name ?? r.companies?.name ?? "");
    if (name && names.has(name)) return false;
    return true;
  });
}
