// Books integrity check for the local-only build. Reads this PC's books only.
import { offlineDb as db } from "@/lib/offline/db";
import { readVouchers, readVoucherEntriesForCompany } from "@/lib/offline/cache-read";

export interface UnbalancedVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  voucher_type: string;
  dr: number;
  cr: number;
  diff: number;
}

export interface LocalVerifyResult {
  checkedVouchers: number;
  unbalanced: UnbalancedVoucher[];
  /** Posting lines whose voucher does not exist on this PC at all. */
  orphanEntries: number;
  /** Posting lines still attached to a voucher that was deleted. */
  linesOnDeletedVouchers: number;
  /** Live vouchers that have no posting lines. */
  emptyVouchers: number;
}

export async function verifyBooksLocal(companyId: string): Promise<LocalVerifyResult> {
  // Live vouchers, normalised the same way the rest of the app reads them.
  const live = (await readVouchers(companyId)) as any[];
  // Every voucher row for the company, including deleted ones, so that lines
  // pointing at a deleted voucher are classified correctly.
  const allRows = (await db.cache_vouchers.where("company_id").equals(companyId).toArray()) as any[];
  const allIds = new Set(allRows.map((v) => String(v.id)));
  const deletedIds = new Set(allRows.filter((v) => v?.is_deleted === true).map((v) => String(v.id)));

  const entries = await readVoucherEntriesForCompany(companyId);
  const totals = new Map<string, { dr: number; cr: number; lines: number }>();
  let orphanEntries = 0;
  let linesOnDeletedVouchers = 0;
  for (const e of entries as any[]) {
    const vid = String(e.voucher_id ?? "");
    if (!allIds.has(vid)) {
      orphanEntries++;
      continue;
    }
    if (deletedIds.has(vid)) {
      linesOnDeletedVouchers++;
      continue;
    }
    const cur = totals.get(vid) ?? { dr: 0, cr: 0, lines: 0 };
    cur.dr += Number(e.debit_paise) || 0;
    cur.cr += Number(e.credit_paise) || 0;
    cur.lines += 1;
    totals.set(vid, cur);
  }

  const unbalanced: UnbalancedVoucher[] = [];
  let emptyVouchers = 0;
  for (const v of live) {
    const id = String(v.id);
    const t = totals.get(id) ?? { dr: 0, cr: 0, lines: 0 };
    if (t.lines === 0) emptyVouchers++;
    if (t.dr !== t.cr) {
      unbalanced.push({
        id,
        voucher_number: String(v.voucher_number ?? ""),
        voucher_date: String(v.voucher_date ?? ""),
        voucher_type: String(v.voucher_type ?? ""),
        dr: t.dr,
        cr: t.cr,
        diff: t.dr - t.cr,
      });
    }
  }

  return {
    checkedVouchers: live.length,
    unbalanced,
    orphanEntries,
    linesOnDeletedVouchers,
    emptyVouchers,
  };
}
