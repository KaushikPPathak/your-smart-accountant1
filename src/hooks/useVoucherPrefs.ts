import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PREFS,
  loadVoucherPrefs,
  saveVoucherPrefs,
  subscribeVoucherPrefs,
  type VoucherPrefs,
} from "@/lib/voucher-prefs";

/** Live per-company voucher preferences (numbering + sales stages). */
export function useVoucherPrefs(companyId: string | null) {
  const [prefs, setPrefs] = useState<VoucherPrefs>(DEFAULT_PREFS);

  const reload = useCallback(async () => {
    const p = await loadVoucherPrefs(companyId);
    setPrefs(p);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await loadVoucherPrefs(companyId);
      if (!cancelled) setPrefs(p);
    })();
    const off = subscribeVoucherPrefs(() => { void reload(); });
    return () => { cancelled = true; off(); };
  }, [companyId, reload]);

  const save = useCallback(async (next: VoucherPrefs) => {
    if (!companyId) return;
    await saveVoucherPrefs(companyId, next);
    setPrefs(next);
  }, [companyId]);

  return { prefs, save, reload };
}
