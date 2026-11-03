/**
 * "Income from other sources only" is a property of the business, so it is
 * shared by all its financial years. Each year is a separate company record,
 * linked to the year it was carried from (carried_from_company_id).
 *
 * - Reading: a year with no explicit setting inherits it from the earlier year.
 * - Writing: the value is saved to every year of the same business.
 *
 * Settings live in this PC's books, so this works offline.
 */

const MAX_HOPS = 50;

type CompanyLink = { id: string; carried_from_company_id?: string | null };

async function loadLinks(): Promise<Map<string, CompanyLink>> {
  const { offlineDb } = await import("./offline/db");
  const rows = (await offlineDb.cache_companies.toArray()) as CompanyLink[];
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** The company ids that belong to this business's chain of years, oldest first. */
export async function businessYearIds(companyId: string): Promise<string[]> {
  const links = await loadLinks();
  // Walk back to the first year of the chain.
  let rootId = companyId;
  for (let i = 0; i < MAX_HOPS; i++) {
    const prev = links.get(rootId)?.carried_from_company_id;
    if (!prev || !links.has(String(prev))) break;
    rootId = String(prev);
  }
  // Every company whose chain starts at the same root belongs to this business.
  const ids = new Set<string>([companyId]);
  for (const id of links.keys()) {
    let cur = id;
    for (let i = 0; i < MAX_HOPS; i++) {
      if (cur === rootId) { ids.add(id); break; }
      const prev = links.get(cur)?.carried_from_company_id;
      if (!prev || !links.has(String(prev))) break;
      cur = String(prev);
    }
  }
  return Array.from(ids);
}

/** Income-from-other-sources flag for a company, inherited from earlier years when not set. */
export async function readIncomeOnly(companyId: string): Promise<boolean> {
  const { offlineDb } = await import("./offline/db");
  const links = await loadLinks();
  let cur: string | null = companyId;
  for (let i = 0; cur && i < MAX_HOPS; i++) {
    const row = await offlineDb.cache_company_settings.where("company_id").equals(cur).first();
    if (row && typeof row.income_only === "boolean") return row.income_only;
    const prev: string | null | undefined = links.get(cur)?.carried_from_company_id;
    cur = prev && links.has(String(prev)) ? String(prev) : null;
  }
  return false;
}

/** Saves the flag for every year of this business. */
export async function writeIncomeOnly(companyId: string, value: boolean): Promise<void> {
  const { offlineDb } = await import("./offline/db");
  const now = new Date().toISOString();
  for (const id of await businessYearIds(companyId)) {
    const existing = await offlineDb.cache_company_settings.where("company_id").equals(id).first();
    if (existing) {
      await offlineDb.cache_company_settings.update(existing.id, { income_only: value, updated_at: now });
    } else {
      await offlineDb.cache_company_settings.put({ id, company_id: id, income_only: value, updated_at: now });
    }
  }
}
