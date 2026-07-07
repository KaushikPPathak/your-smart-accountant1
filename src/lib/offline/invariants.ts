// src/lib/offline/invariants.ts
//
// Silent, at-write and at-boot invariant enforcement for the local IndexedDB.
// The app is designed so nothing ever needs a user-visible "repair":
//
//   - Every voucher write goes through a transaction that already balances
//     debit = credit (see `assertVoucherBalanced` in voucher-invariants.ts).
//   - Orphan `voucher_entries` / `voucher_items` rows (children whose parent
//     voucher was deleted or never materialised) are swept silently on app
//     boot and after every successful write.
//   - Item vouchers whose derived postings drifted from the stored totals
//     are re-derived on the spot from their own totals + ITC class using
//     `buildItemVoucherPostings`. This is not a "repair" — the totals are
//     the source of truth, the entries are derived from them.
//
// All of this runs quietly in the background. No toast, no prompt, no
// admin toggle. The user should never learn these functions exist.

import { offlineDb } from "@/lib/offline/db";
import { buildItemVoucherPostings, type ItemVoucherKind, type ItcClass } from "@/lib/voucher-postings";

const ITEM_KINDS = new Set<string>(["sales", "purchase", "credit_note", "debit_note"]);

let running = false;
let lastRunAt = 0;
const MIN_INTERVAL_MS = 30_000; // don't thrash if called repeatedly

/**
 * Sweep orphan child rows and re-derive item-voucher postings when they
 * drift from the stored totals. Silent, idempotent, safe to call anytime.
 */
export async function enforceLocalInvariants(): Promise<void> {
  if (running) return;
  const now = Date.now();
  if (now - lastRunAt < MIN_INTERVAL_MS) return;
  running = true;
  try {
    const [vouchers, entries, items] = await Promise.all([
      offlineDb.cache_vouchers.toArray(),
      offlineDb.cache_voucher_entries.toArray(),
      offlineDb.cache_voucher_items.toArray(),
    ]);

    const liveIds = new Set(
      (vouchers as any[]).filter((v) => v?.is_deleted !== true).map((v) => v.id as string),
    );

    // 1) Drop orphan children.
    const orphanEntries = (entries as any[]).filter((e) => !liveIds.has(e.voucher_id));
    const orphanItems = (items as any[]).filter((i) => !liveIds.has(i.voucher_id));
    if (orphanEntries.length || orphanItems.length) {
      await offlineDb.transaction(
        "rw",
        offlineDb.cache_voucher_entries,
        offlineDb.cache_voucher_items,
        async () => {
          if (orphanEntries.length) await offlineDb.cache_voucher_entries.bulkDelete(orphanEntries.map((e) => e.id));
          if (orphanItems.length)   await offlineDb.cache_voucher_items.bulkDelete(orphanItems.map((i) => i.id));
        },
      );
    }

    // 2) Re-derive item-voucher postings when they drift from stored totals.
    //    Group live entries by voucher for O(N) scan.
    const liveEntriesByVoucher = new Map<string, any[]>();
    for (const e of entries as any[]) {
      if (!liveIds.has(e.voucher_id)) continue;
      const arr = liveEntriesByVoucher.get(e.voucher_id) ?? [];
      arr.push(e);
      liveEntriesByVoucher.set(e.voucher_id, arr);
    }
    const itemsByVoucher = new Map<string, any[]>();
    for (const i of items as any[]) {
      if (!liveIds.has(i.voucher_id)) continue;
      const arr = itemsByVoucher.get(i.voucher_id) ?? [];
      arr.push(i);
      itemsByVoucher.set(i.voucher_id, arr);
    }

    for (const v of vouchers as any[]) {
      if (v?.is_deleted) continue;
      if (!ITEM_KINDS.has(v.voucher_type)) continue;
      if (!v.party_ledger_id) continue;

      const existing = liveEntriesByVoucher.get(v.id) ?? [];
      const dr = existing.reduce((s, e) => s + (e.debit_paise ?? 0), 0);
      const cr = existing.reduce((s, e) => s + (e.credit_paise ?? 0), 0);
      // Fast-path: entries exist AND balance AND debit total matches the
      // stored voucher total — treat as good, don't rebuild.
      if (existing.length > 0 && dr === cr && dr === (v.total_paise ?? 0)) continue;

      try {
        const totals = {
          subtotal_paise: v.subtotal_paise ?? 0,
          cgst_paise: v.cgst_paise ?? 0,
          sgst_paise: v.sgst_paise ?? 0,
          igst_paise: v.igst_paise ?? 0,
          total_paise: v.total_paise ?? 0,
          round_off_paise: v.round_off_paise ?? 0,
        };
        const capitalItems =
          v.itc_class === "capital_goods"
            ? (itemsByVoucher.get(v.id) ?? []).map((i) => ({
                name: (i.description || "Capital Asset").toString().trim(),
                taxable_paise: i.taxable_paise ?? 0,
                cgst_paise: i.cgst_paise ?? 0,
                sgst_paise: i.sgst_paise ?? 0,
                igst_paise: i.igst_paise ?? 0,
              }))
            : undefined;
        const postings = await buildItemVoucherPostings(
          v.company_id,
          v.voucher_type as ItemVoucherKind,
          v.party_ledger_id,
          totals,
          {
            itcClass: (v.itc_class ?? "na") as ItcClass,
            itcEligible: v.itc_eligible ?? true,
            capitalItems,
          },
        );
        const stamp = new Date().toISOString();
        const rows = postings.map((p) => ({
          id: crypto.randomUUID(),
          voucher_id: v.id,
          company_id: v.company_id,
          ledger_id: p.ledger_id,
          debit_paise: p.debit_paise,
          credit_paise: p.credit_paise,
          narration: p.narration ?? null,
          line_no: p.line_no,
          updated_at: stamp,
        }));
        await offlineDb.transaction("rw", offlineDb.cache_voucher_entries, async () => {
          if (existing.length) await offlineDb.cache_voucher_entries.bulkDelete(existing.map((e: any) => e.id));
          if (rows.length) await offlineDb.cache_voucher_entries.bulkPut(rows);
        });
      } catch {
        // Swallow — a single voucher must never block the boot sweep.
      }
    }

    lastRunAt = Date.now();
  } catch {
    // Silent — invariants are best-effort.
  } finally {
    running = false;
  }
}
