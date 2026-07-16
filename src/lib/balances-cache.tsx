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
import {
  readLedgers,
  readVouchers,
  readVoucherEntriesForCompany,
} from "./offline/cache-read";

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

async function computeAll(companyId: string) {
  const [ledgers, vouchers, entries] = await Promise.all([
    readLedgers(companyId),
    readVouchers(companyId),
    readVoucherEntriesForCompany(companyId),
  ]);
  const voucherById = new Map(
    (vouchers as any[]).map((v) => [String(v.id), v]),
  );
  const bal = new Map<string, LedgerBalance>();
  for (const l of ledgers as any[]) {
    const ob = (l.opening_balance_is_debit ? 1 : -1) * Number(l.opening_balance_paise ?? 0);
    bal.set(String(l.id), {
      paise: ob,
      name: String(l.name ?? ""),
      type: String(l.type ?? ""),
    });
  }
  const recent = new Map<string, LedgerRecentEntry[]>();
  for (const e of entries as any[]) {
    const ledgerId = String(e.ledger_id ?? "");
    if (!ledgerId) continue;
    const debit = Number(e.debit_paise ?? 0);
    const credit = Number(e.credit_paise ?? 0);
    const cur = bal.get(ledgerId);
    if (cur) cur.paise += debit - credit;
    const v = voucherById.get(String(e.voucher_id));
    if (!v) continue;
    const entry: LedgerRecentEntry = {
      voucher_id: String(v.id),
      voucher_number: v.voucher_number ?? null,
      voucher_date: String(v.voucher_date ?? v.date ?? ""),
      voucher_type: v.voucher_type ?? null,
      narration: v.narration ?? null,
      debit_paise: debit,
      credit_paise: credit,
    };
    const list = recent.get(ledgerId);
    if (list) list.push(entry);
    else recent.set(ledgerId, [entry]);
  }
  // Sort recents desc by date; keep at most 25 in memory (chip shows 10).
  for (const [k, list] of recent) {
    list.sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : -1));
    if (list.length > 25) recent.set(k, list.slice(0, 25));
  }
  return { bal, recent };
}

export function BalancesProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompany();
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(0);

  const reload = useCallback(async () => {
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
    try {
      const { bal, recent } = await computeAll(cid);
      if (token !== tokenRef.current) return;
      balances.clear();
      recentByLedger.clear();
      for (const [k, v] of bal) balances.set(k, v);
      for (const [k, v] of recent) recentByLedger.set(k, v);
      currentCompanyId = cid;
      bump();
      setReady(true);
    } catch (e) {
      console.error("[balances-cache] load failed", e);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh whenever a voucher is saved (save-status broadcasts via window
  // custom event — see refreshBalances() below, called from voucher-executors
  // downstream. For now poll on visibility to keep it simple.)
  useEffect(() => {
    const onSaved = () => {
      void reload();
    };
    window.addEventListener("ym:voucher-saved", onSaved);
    return () => window.removeEventListener("ym:voucher-saved", onSaved);
  }, [reload]);

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
