/**
 * Per-company voucher preferences (local-only).
 *
 * Two things live here:
 *  1. Numbering rules per voucher type (see `voucher-numbering.ts`).
 *  2. Which sales-cycle stages the business actually uses — quotation /
 *     estimate, sales order, delivery challan. Unticked stages simply stay
 *     out of the menus; nothing is deleted.
 *
 * Stored in the local Dexie `meta` key/value table. Never synced.
 */
import { offlineDb } from "@/lib/offline/db";
import { DEFAULT_RULE, type NumberingRule } from "@/lib/voucher-numbering";

export const SALES_STAGES = [
  { key: "quotation", label: "Quotation / Estimate", desc: "Priced offer sent before an order is confirmed." },
  { key: "sales_order", label: "Sales Order", desc: "Confirmed customer order, pending delivery." },
  { key: "delivery_note", label: "Delivery Challan", desc: "Goods dispatched, invoice may follow later." },
] as const;

export type SalesStageKey = (typeof SALES_STAGES)[number]["key"];

export interface VoucherPrefs {
  /** voucher_type → numbering rule. Missing = plain serial. */
  rules: Record<string, NumberingRule>;
  /** sales stage → enabled. Sales invoice is always enabled. */
  stages: Record<SalesStageKey, boolean>;
}

export const DEFAULT_PREFS: VoucherPrefs = {
  rules: {},
  stages: { quotation: false, sales_order: false, delivery_note: false },
};

const metaKey = (companyId: string) => `voucher_prefs:${companyId}`;

const cache = new Map<string, VoucherPrefs>();
const listeners = new Set<() => void>();

function normalize(raw: unknown): VoucherPrefs {
  const v = (raw ?? {}) as Partial<VoucherPrefs>;
  const rules: Record<string, NumberingRule> = {};
  for (const [k, r] of Object.entries(v.rules ?? {})) {
    rules[k] = { ...DEFAULT_RULE, ...(r as NumberingRule) };
  }
  return {
    rules,
    stages: { ...DEFAULT_PREFS.stages, ...(v.stages ?? {}) },
  };
}

export async function loadVoucherPrefs(companyId: string | null): Promise<VoucherPrefs> {
  if (!companyId) return DEFAULT_PREFS;
  const hit = cache.get(companyId);
  if (hit) return hit;
  try {
    const row = await offlineDb.meta.get(metaKey(companyId));
    const prefs = normalize((row as { value?: unknown } | undefined)?.value);
    cache.set(companyId, prefs);
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveVoucherPrefs(companyId: string, prefs: VoucherPrefs): Promise<void> {
  const next = normalize(prefs);
  cache.set(companyId, next);
  try {
    await offlineDb.meta.put({ key: metaKey(companyId), value: next, updated_at: new Date().toISOString() });
  } catch {
    /* local storage unavailable — keep in-memory copy */
  }
  listeners.forEach((fn) => { try { fn(); } catch { /* noop */ } });
}

export function subscribeVoucherPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function ruleFor(prefs: VoucherPrefs, voucherType: string): NumberingRule {
  return { ...DEFAULT_RULE, ...(prefs.rules[voucherType] ?? {}) };
}

/** Voucher types hidden because their sales stage is switched off. */
export function hiddenVoucherTypes(prefs: VoucherPrefs): Set<string> {
  const hidden = new Set<string>();
  for (const s of SALES_STAGES) if (!prefs.stages[s.key]) hidden.add(s.key);
  return hidden;
}
