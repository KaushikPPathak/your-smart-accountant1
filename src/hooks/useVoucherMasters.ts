import { useEffect, useState } from "react";
import { offlineDb } from "@/lib/offline/db";
import type { TaxTemplate, VoucherSeries } from "@/lib/voucher-resolver";

/**
 * Read voucher primitives from local IndexedDB (Dexie).
 * Local-only per project rule — never fetches from server.
 *
 * Returns empty arrays when no rows exist, which is the default state for
 * every user today. The resolver treats empty → `hidden`, so voucher forms
 * render exactly as they do today until the user opts in by creating a
 * template or series through settings.
 */
export function useTaxTemplates(companyId: string | null): TaxTemplate[] {
  const [rows, setRows] = useState<TaxTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!companyId) { setRows([]); return; }
    (async () => {
      try {
        const all = await offlineDb.cache_tax_templates
          .where("company_id").equals(companyId).toArray();
        if (!cancelled) setRows(all as TaxTemplate[]);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [companyId]);
  return rows;
}

export function useVoucherSeries(
  companyId: string | null,
  voucherType: string,
): VoucherSeries[] {
  const [rows, setRows] = useState<VoucherSeries[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!companyId) { setRows([]); return; }
    (async () => {
      try {
        const all = await offlineDb.cache_voucher_series
          .where("[company_id+voucher_type]").equals([companyId, voucherType]).toArray();
        if (!cancelled) setRows(all as VoucherSeries[]);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [companyId, voucherType]);
  return rows;
}
