/**
 * Live ledger-balance cache for data entry.
 *
 * Reads exclusively from the offline IndexedDB cache (local-only mode) — no
 * network calls — so voucher forms can show a running balance chip next to
 * every party / cash / bank picker without a per-keystroke Supabase round
 * trip.
 *
 * Balance basis: current closing balance (all vouchers, no date filter).
 * Sign convention: +paise = Debit, -paise = Credit.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useCompany } from "./company-context";
import { useSaveStatus } from "./save-status";
import { readLedgers } from "./offline/cache-read";
import { offlineDb } from "./offline/db";

export interface LedgerBalance {
  paise: number; // signed: +Dr, -Cr
  name: string;
  type: string;
}

export interface LedgerRecentEntry {
  voucher_id: string;
  voucher_number: string | null;
  voucher_date: string;
  voucher_type: string | null;
  narration: string | null;
  debit_paise: number;
  credit_paise: number;
}

const balances = new Map<string, LedgerBalance>();
const recentByLedger = new Map<string, LedgerRecentEntry[]>();
let currentCompanyId: string | null = null;

let version = 0;
const listeners = new Set<() => void>();
function bump() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function getVersion() {
  return version;
}

export function getLedgerBalance(id: string | null | undefined): LedgerBalance | undefined {
  return id ? balances.get(id) : undefined;
}

export function getRecentLedgerEntries(id: string, limit = 10): LedgerRecentEntry[] {
  const list = recentByLedger.get(id) ?? [];
  return list.slice(0, limit);
}

/**
 * Load mini-ledger rows only when the user opens a balance popover. Keeping
 * voucher metadata off the startup path prevents large books from competing
 * with keyboard input while preserving the last-10 view on demand.
 */
export async function loadRecentLedgerEntries(
  id: string,
  limit = 10,
): Promise<LedgerRecentEntry[]> {
  const companyId = currentCompanyId;
  const [entries, vouchers] = await Promise.all([
    companyId
      ? offlineDb.cache_voucher_entries
          .where("[company_id+ledger_id]")
          .equals([companyId, id])
          .toArray()
      : Promise.resolve([]),
    companyId
      ? offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray()
      : Promise.resolve([]),
  ]);
  const voucherById = new Map<string, any>();
  for (const v of vouchers as any[]) {
    if (v?.is_deleted !== true) voucherById.set(String(v.id), v);
  }
  const result: LedgerRecentEntry[] = [];
  for (const e of entries as any[]) {
    const v = voucherById.get(String(e.voucher_id));
    if (!v) continue;
    result.push({
      voucher_id: String(v.id),
      voucher_number: v.voucher_number ?? null,
      voucher_date: String(v.voucher_date ?? v.date ?? ""),
      voucher_type: v.voucher_type ?? null,
      narration: v.narration ?? null,
      debit_paise: Number(e.debit_paise ?? 0),
      credit_paise: Number(e.credit_paise ?? 0),
    });
  }
  result.sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : -1));
  const recent = result.slice(0, Math.max(limit, 25));
  recentByLedger.set(id, recent);
  return recent.slice(0, limit);
}

export function useBalancesVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export function useLedgerBalance(id: string | null | undefined): LedgerBalance | undefined {
  useBalancesVersion();
  return getLedgerBalance(id);
}

interface Ctx {
  ready: boolean;
  reload: () => Promise<void>;
}
const BalancesCtx = createContext<Ctx>({ ready: false, reload: async () => undefined });

async function computeAll(companyId: string, isCancelled: () => boolean) {
  const [ledgers, entries] = await Promise.all([
    readLedgers(companyId),
    offlineDb.cache_voucher_entries.where("company_id").equals(companyId).toArray(),
  ]);
  if (isCancelled()) return null;
  const bal = new Map<string, LedgerBalance>();
  for (const l of ledgers as any[]) {
    const ob = (l.opening_balance_is_debit ? 1 : -1) * Number(l.opening_balance_paise ?? 0);
    bal.set(String(l.id), {
      paise: ob,
      name: String(l.name ?? ""),
      type: String(l.type ?? ""),
    });
  }
  const arr = entries as any[];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const ledgerId = String(e.ledger_id ?? "");
    if (!ledgerId) continue;
    const debit = Number(e.debit_paise ?? 0);
    const credit = Number(e.credit_paise ?? 0);
    const cur = bal.get(ledgerId);
    if (cur) cur.paise += debit - credit;
  }
  if (isCancelled()) return null;
  return { bal };
}

export function BalancesProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompany();
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  const runReload = useCallback(async () => {
    const cid = activeCompanyId;
    const token = ++tokenRef.current;
    if (!cid) {
      balances.clear();
      recentByLedger.clear();
      currentCompanyId = null;
      bump();
      setReady(false);
      return;
    }
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    runningRef.current = true;
    try {
      const result = await computeAll(cid, () => token !== tokenRef.current);
      if (!result) return;
      const { bal } = result;
      if (token !== tokenRef.current) return;
      balances.clear();
      for (const [k, v] of bal) balances.set(k, v);
      currentCompanyId = cid;
      bump();
      setReady(true);
    } catch (e) {
      console.error("[balances-cache] load failed", e);
    } finally {
      runningRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setTimeout(() => { void runReload(); }, 0);
      }
    }
  }, [activeCompanyId]);

  const reload = useCallback(async () => {
    // Debounce all triggers (initial mount, save events) so bursts of saves
    // collapse into a single recompute and never contend with keydown work.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runReload();
    }, 500);
  }, [runReload]);

  useEffect(() => {
    void reload();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [reload]);

  // Refresh whenever any save completes (save-status broadcasts through
  // `markSaved`). This covers voucher CRUD, master edits, etc.
  const { lastSavedAt } = useSaveStatus();
  useEffect(() => {
    if (!lastSavedAt || !activeCompanyId) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSavedAt]);

  // External nudge (e.g. inline optimistic updates outside the save queue).
  useEffect(() => {
    const onSaved = () => { void reload(); };
    const onRestored = () => { void runReload(); };
    window.addEventListener("ym:voucher-saved", onSaved);
    window.addEventListener("ym:local-data-restored", onRestored);
    return () => {
      window.removeEventListener("ym:voucher-saved", onSaved);
      window.removeEventListener("ym:local-data-restored", onRestored);
    };
  }, [reload, runReload]);

  return <BalancesCtx.Provider value={{ ready, reload }}>{children}</BalancesCtx.Provider>;
}

export function useBalances() {
  return useContext(BalancesCtx);
}

/** Fire this after a voucher save/edit/delete so open forms refresh. */
export function notifyVoucherSaved() {
  try {
    window.dispatchEvent(new CustomEvent("ym:voucher-saved"));
  } catch { /* ignore */ }
}

export function getCurrentBalancesCompanyId() {
  return currentCompanyId;
}
