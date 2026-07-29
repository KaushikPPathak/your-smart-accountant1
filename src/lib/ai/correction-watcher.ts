// Correction watcher — Phase C, "learning from corrections".
//
// When the assistant drafts a voucher and writes an AssistantPrefill, we
// stash a watch record here. Whenever a voucher is saved for that company
// within the watch window, we compare the most recent voucher against the
// original prefill and log any user overrides via logCorrection(). The
// system prompt (persistent-memory.buildMemorySnapshot) surfaces the
// existence of recent corrections so the model learns to respect them.
//
// Everything runs on-device against IndexedDB. No LLM tokens spent on
// learning; only on the next question that benefits from the memory.

import type { AssistantPrefill } from "@/lib/voucher-intent";
import { onDataChange } from "./cache-events";
import { readVouchers } from "@/lib/offline/cache-read";
import { logCorrection } from "./persistent-memory";

interface WatchRecord {
  prefill: AssistantPrefill;
  armedAt: number;
}

const WATCH_TTL_MS = 5 * 60 * 1000; // 5 minutes after prefill is written
let pending: WatchRecord | null = null;
let subscribed = false;

/** Called by writeAssistantPrefill — arms a watch for the next voucher save. */
export function armCorrectionWatch(prefill: AssistantPrefill): void {
  pending = { prefill, armedAt: Date.now() };
  ensureSubscribed();
}

/** Clear the pending watch without logging. Exposed for tests. */
export function disarmCorrectionWatch(): void {
  pending = null;
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  onDataChange((evt) => {
    if (evt.kind !== "voucher") return;
    const watch = pending;
    if (!watch) return;
    if (Date.now() - watch.armedAt > WATCH_TTL_MS) { pending = null; return; }
    // Fire-and-forget; don't block the save path.
    void reconcile(evt.companyId, watch).finally(() => { pending = null; });
  });
}

async function reconcile(companyId: string, watch: WatchRecord): Promise<void> {
  const kind = watch.prefill.voucherType;
  try {
    const rows = await readVouchers(companyId, { voucher_type: kind as string });
    if (!rows.length) return;
    // readVouchers returns newest-first
    const saved = rows[0] as Record<string, unknown>;

    const diffs: Record<string, { before: unknown; after: unknown }> = {};

    const before = watch.prefill;
    const check = (
      field: string,
      beforeVal: unknown,
      afterVal: unknown,
    ) => {
      if (beforeVal == null || beforeVal === "") return;
      if (afterVal == null || afterVal === "") return;
      const b = typeof beforeVal === "number" ? beforeVal : String(beforeVal).trim().toLowerCase();
      const a = typeof afterVal === "number" ? afterVal : String(afterVal).trim().toLowerCase();
      if (b !== a) diffs[field] = { before: beforeVal, after: afterVal };
    };

    check("date",    before.date,     saved.voucher_date);
    check("refNo",   before.refNo,    saved.voucher_number);
    check("narration", before.narration, saved.narration);
    // total_amount is stored in paise on cache rows in some builds; be forgiving.
    if (typeof before.amount === "number") {
      const savedTotal = numericTotal(saved.total_amount);
      if (savedTotal != null) {
        const a = Math.round(savedTotal);
        const b = Math.round(before.amount);
        // tolerate ±1 (rounding) — anything bigger is a real correction
        if (Math.abs(a - b) > 1 && Math.abs((a / 100) - b) > 1) {
          diffs.amount = { before: before.amount, after: savedTotal };
        }
      }
    }
    check("partyLedgerId",    before.partyLedgerId,    saved.party_ledger_id);
    check("cashBankLedgerId", before.cashBankLedgerId, saved.cash_bank_ledger_id);

    if (Object.keys(diffs).length === 0) return;

    await logCorrection({
      companyId,
      kind: "voucher_edit",
      before: { source: "assistant_prefill", prefill: before },
      after: { voucher_number: saved.voucher_number, diffs },
      note: `User overrode ${Object.keys(diffs).join(", ")} on ${kind} draft.`,
    });
  } catch {
    // Never let learning break the save flow.
  }
}

function numericTotal(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
