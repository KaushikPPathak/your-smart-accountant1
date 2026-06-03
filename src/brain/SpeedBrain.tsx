import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { isTauriRuntime, safeBrainExec, safeBrainSelect } from "./SqliteBrain";

interface CompanyRow {
  id: string;
  name: string;
  [k: string]: unknown;
}
interface LedgerRow {
  id: string;
  name: string;
  group_name?: string | null;
  gst_applicable?: number | null;
}
interface PartyRow {
  id: string;
  name: string;
  txn_count?: number;
  [k: string]: unknown;
}
interface StockRow {
  id: string;
  name: string;
  unit?: string | null;
  gst_rate?: number | null;
  selling_price?: number | null;
}
interface RecentVoucherRow {
  id: string;
  voucher_type?: string | null;
  date?: string | null;
  party_name?: string | null;
  [k: string]: unknown;
}

interface BrainCache {
  company: CompanyRow | null;
  ledgers: LedgerRow[];
  parties: PartyRow[];
  stockItems: StockRow[];
  recentVouchers: RecentVoucherRow[];
  loadedAt: string | null;
}

const EMPTY_CACHE: BrainCache = {
  company: null,
  ledgers: [],
  parties: [],
  stockItems: [],
  recentVouchers: [],
  loadedAt: null,
};

interface SpeedBrainContextValue {
  CACHE: BrainCache;
  refresh: () => Promise<void>;
}

const SpeedBrainContext = createContext<SpeedBrainContextValue>({
  CACHE: EMPTY_CACHE,
  refresh: async () => {},
});

export function useSpeedBrain(): SpeedBrainContextValue {
  return useContext(SpeedBrainContext);
}

async function loadAll(): Promise<BrainCache> {
  if (!isTauriRuntime()) return { ...EMPTY_CACHE, loadedAt: new Date().toISOString() };

  const [companies, ledgers, parties, stockItems, recentVouchers] = await Promise.all([
    safeBrainSelect<CompanyRow>(`SELECT * FROM companies WHERE is_active = 1 LIMIT 1`),
    safeBrainSelect<LedgerRow>(
      `SELECT id, name, group_name, gst_applicable FROM ledgers ORDER BY name ASC`,
    ),
    safeBrainSelect<PartyRow>(
      `SELECT p.*, COUNT(v.id) as txn_count FROM parties p
       LEFT JOIN vouchers v ON v.party_id = p.id
       GROUP BY p.id ORDER BY txn_count DESC LIMIT 50`,
    ),
    safeBrainSelect<StockRow>(
      `SELECT id, name, unit, gst_rate, selling_price FROM stock_items ORDER BY name ASC LIMIT 100`,
    ),
    safeBrainSelect<RecentVoucherRow>(
      `SELECT v.*, p.name as party_name FROM vouchers v
       LEFT JOIN parties p ON v.party_id = p.id
       ORDER BY v.created_at DESC LIMIT 30`,
    ),
  ]);

  return {
    company: companies[0] ?? null,
    ledgers,
    parties,
    stockItems,
    recentVouchers,
    loadedAt: new Date().toISOString(),
  };
}

export function SpeedBrainProvider({ children }: { children: React.ReactNode }) {
  const [cache, setCache] = useState<BrainCache>(EMPTY_CACHE);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const refresh = useCallback(async () => {
    const next = await loadAll();
    setCache(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const interval = setInterval(() => {
      const snapshot = JSON.stringify(cacheRef.current);
      void safeBrainExec(
        `INSERT INTO brain_cache (cache_key, cache_value, updated_at)
         VALUES ('main_cache', $1, $2)
         ON CONFLICT(cache_key) DO UPDATE SET cache_value = excluded.cache_value, updated_at = excluded.updated_at`,
        [snapshot, new Date().toISOString()],
      );
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <SpeedBrainContext.Provider value={{ CACHE: cache, refresh }}>
      {children}
    </SpeedBrainContext.Provider>
  );
}
