/**
 * Tiny external store that the currently-active voucher form uses to publish
 * which ledgers are "in context" (party, cash/bank). The StatusBar reads it
 * to render a live balance strip regardless of which form is open.
 */
import { useSyncExternalStore } from "react";

export interface VoucherContext {
  partyLedgerId: string | null;
  cashBankLedgerId: string | null;
  /** Human label for the voucher — e.g. "Sales Invoice". Optional. */
  label?: string | null;
}

const state: VoucherContext = { partyLedgerId: null, cashBankLedgerId: null, label: null };
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snap() { return state; }

export function setVoucherContext(patch: Partial<VoucherContext>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof VoucherContext)[]) {
    const v = patch[k] ?? null;
    if ((state as any)[k] !== v) {
      (state as any)[k] = v;
      changed = true;
    }
  }
  if (changed) emit();
}

export function clearVoucherContext() {
  if (
    state.partyLedgerId !== null ||
    state.cashBankLedgerId !== null ||
    state.label !== null
  ) {
    state.partyLedgerId = null;
    state.cashBankLedgerId = null;
    state.label = null;
    emit();
  }
}

export function useVoucherContext(): VoucherContext {
  return useSyncExternalStore(subscribe, snap, snap);
}
