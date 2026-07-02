// Duplicate reference/cheque-number detection for entry vouchers.
//
// Reads primarily from the Dexie offline cache (instant, works offline).
// Also does a best-effort Supabase check when online, so a cheque number
// entered on another device is caught even if the local cache is stale.

import { offlineDb } from "@/lib/offline/db";
import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow } from "@/lib/offline/online-status";

export interface DuplicateVoucherHit {
  id: string;
  voucher_date: string;
  voucher_type: string;
  reference_no: string | null;
  total_paise?: number | null;
}

/**
 * Look up any existing voucher in the same company/voucher-type with the same
 * (case-insensitive, trimmed) reference/cheque number. Bank-payment cheques
 * MUST be unique per company — banks reject a re-used cheque number.
 */
export async function findDuplicateReference(
  companyId: string,
  voucherType: string,
  refNo: string,
): Promise<DuplicateVoucherHit[]> {
  const ref = (refNo ?? "").trim();
  if (!ref) return [];
  const lower = ref.toLowerCase();
  const hits: DuplicateVoucherHit[] = [];

  try {
    const local = await offlineDb.cache_vouchers
      .where("company_id")
      .equals(companyId)
      .filter((v: any) => {
        if (v.is_deleted) return false;
        if (v.voucher_type !== voucherType) return false;
        const r = (v.reference_no ?? "").toString().trim().toLowerCase();
        return r === lower;
      })
      .toArray();
    for (const v of local as any[]) {
      hits.push({
        id: v.id,
        voucher_date: v.voucher_date,
        voucher_type: v.voucher_type,
        reference_no: v.reference_no ?? null,
        total_paise: v.total_paise ?? null,
      });
    }
  } catch {
    // ignore — Dexie might be unavailable
  }

  if (isOnlineNow()) {
    try {
      const { data } = await supabase
        .from("vouchers")
        .select("id, voucher_date, voucher_type, reference_no, total_paise")
        .eq("company_id", companyId)
        .eq("voucher_type", voucherType)
        .ilike("reference_no", ref)
        .limit(5);
      if (data) {
        for (const v of data as any[]) {
          if (!hits.some((h) => h.id === v.id)) hits.push(v as DuplicateVoucherHit);
        }
      }
    } catch {
      // ignore network failures — local check is authoritative
    }
  }

  return hits;
}
