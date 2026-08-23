
/**
 * Shared master data logic for vouchers.
 */
import { useMemo } from "react";
import { getAllLedgers, useMastersVersion } from "@/lib/masters-cache";
import { useCompany } from "@/lib/company-context";

export interface LedgerOpt {
  id: string;
  name: string;
  type: string;
  state_code?: string | null;
  gstin?: string | null;
  gst_treatment?: string | null;
}

/**
 * Hook to get and filter ledgers for pickers.
 */
export function useLedgerOptions(filterFn?: (l: any) => boolean) {
  const { activeCompanyId } = useCompany();
  const mastersVersion = useMastersVersion();

  const ledgers = useMemo(() => {
    const all = getAllLedgers();
    const filtered = filterFn ? all.filter(filterFn) : all;
    return filtered.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      state_code: l.state_code,
      gstin: l.gstin,
      gst_treatment: l.gst_treatment,
    }));
  }, [mastersVersion, activeCompanyId, filterFn]);

  return ledgers;
}
