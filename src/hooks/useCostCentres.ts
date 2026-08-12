import { useEffect, useState, useCallback } from "react";
import offlineDb from "@/lib/offline/db";

export interface CostCentre {
  id: string;
  company_id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface CostCategory {
  id: string;
  company_id: string;
  name: string;
  is_active: boolean;
  updated_at: string;
}

async function loadFor<T>(table: string, companyId: string): Promise<T[]> {
  try {
    const rows = await (offlineDb as any)[table]
      .where("company_id")
      .equals(companyId)
      .toArray();
    return (rows as T[]).filter((r: any) => r.is_active !== false)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function useCostCentres(companyId: string | null) {
  const [centres, setCentres] = useState<CostCentre[]>([]);
  const [categories, setCategories] = useState<CostCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!companyId) { setCentres([]); setCategories([]); setLoading(false); return; }
    setLoading(true);
    const [cc, cat] = await Promise.all([
      loadFor<CostCentre>("cache_cost_centres", companyId),
      loadFor<CostCategory>("cache_cost_categories", companyId),
    ]);
    setCentres(cc);
    setCategories(cat);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { reload(); }, [reload]);

  return { centres, categories, loading, reload };
}
