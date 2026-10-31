// Manual stock valuation per company and date, stored in the local database.
// One value per (company_id, as_of_date). Reports read it first and fall back
// to the WAC valuation when no manual value exists for that date.
import { getDbInstance, newId } from "@/lib/utils/sys-utils";

/** Manual valuation in paise for this company and date, or null when none is set. */
export async function getManualValuation(companyId: string, asOfDate: string): Promise<number | null> {
  if (!companyId || !asOfDate) return null;
  const db = await getDbInstance();
  const row = await db.cache_manual_valuations
    .where("[company_id+as_of_date]")
    .equals([companyId, asOfDate])
    .first();
  return row ? Number(row.valuation_paise) : null;
}

/** Save (or replace) the manual valuation for this company and date. */
export async function setManualValuation(companyId: string, asOfDate: string, valuationPaise: number): Promise<void> {
  const db = await getDbInstance();
  const now = new Date().toISOString();
  const existing = await db.cache_manual_valuations
    .where("[company_id+as_of_date]")
    .equals([companyId, asOfDate])
    .first();
  if (existing) {
    await db.cache_manual_valuations.update(existing.id, {
      valuation_paise: Math.round(valuationPaise),
      updated_at: now,
    });
    return;
  }
  await db.cache_manual_valuations.put({
    id: newId(),
    company_id: companyId,
    as_of_date: asOfDate,
    valuation_paise: Math.round(valuationPaise),
    created_at: now,
    updated_at: now,
  });
}

/** Remove the manual valuation for this company and date. */
export async function clearManualValuation(companyId: string, asOfDate: string): Promise<void> {
  const db = await getDbInstance();
  await db.cache_manual_valuations
    .where("[company_id+as_of_date]")
    .equals([companyId, asOfDate])
    .delete();
}

/** All manual valuations of a company (used by backup). */
export async function listManualValuations(companyId: string): Promise<Record<string, unknown>[]> {
  const db = await getDbInstance();
  return (await db.cache_manual_valuations.where("company_id").equals(companyId).toArray()) as Record<string, unknown>[];
}
