// Stock costing method per company (average, FIFO or LIFO), kept in the local
// books. Defaults to average cost when nothing has been chosen.
import { getDbInstance, newId } from "@/lib/utils/sys-utils";
import type { ValuationMethod } from "@/lib/inventory/valuation-engine";

const METHODS: ValuationMethod[] = ["average", "fifo", "lifo"];

export function normaliseValuationMethod(raw: unknown): ValuationMethod {
  const v = String(raw ?? "").toLowerCase();
  return (METHODS as string[]).includes(v) ? (v as ValuationMethod) : "average";
}

/** The costing method chosen for this company, or average cost if none is set. */
export async function getValuationMethod(companyId: string): Promise<ValuationMethod> {
  if (!companyId) return "average";
  const db = await getDbInstance();
  const row = await db.cache_company_settings.where("company_id").equals(companyId).first();
  return normaliseValuationMethod(row?.stock_valuation_method);
}

/** Save the costing method for this company in its local settings. */
export async function setValuationMethod(companyId: string, method: ValuationMethod): Promise<void> {
  const db = await getDbInstance();
  const now = new Date().toISOString();
  const existing = await db.cache_company_settings.where("company_id").equals(companyId).first();
  if (existing) {
    await db.cache_company_settings.update(existing.id, { stock_valuation_method: method, updated_at: now });
    return;
  }
  await db.cache_company_settings.put({
    id: newId(),
    company_id: companyId,
    stock_valuation_method: method,
    updated_at: now,
  });
}
