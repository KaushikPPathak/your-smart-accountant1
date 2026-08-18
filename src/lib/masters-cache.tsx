import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "./company-context";
import { isLocalOnlyMode } from "./local-only-mode";
import { readItems, readLedgers, shouldPreferOfflineCache } from "@/lib/offline/cache-read";

// Initialize Search Worker
let searchWorker: Worker | null = null;
if (typeof window !== "undefined") {
  searchWorker = new Worker(new URL("../workers/masters-search.worker.ts", import.meta.url), {
    type: "module",
  });
}

const pendingRequests = new Map<string, (results: any[]) => void>();

if (searchWorker) {
  searchWorker.onmessage = (e) => {
    const { type, payload } = e.data;
    if (type === "SEARCH_RESULTS") {
      const { results, requestId } = payload;
      const resolve = pendingRequests.get(requestId);
      if (resolve) {
        resolve(results);
        pendingRequests.delete(requestId);
      }
    }
  };
}


export interface CachedLedger {
  id: string;
  name: string;
  _folded_name?: string; // Precomputed for search performance
  type: string;
  state_code: string | null;
  gstin: string | null;
  gst_treatment: string | null;
  gst_registration_type?: string | null;
  msme_registered?: boolean | null;
  msme_udyam_no?: string | null;
  msme_classification?: string | null;
  credit_days?: number | null;
  is_active: boolean;
}

export interface CachedItem {
  id: string;
  name: string;
  _folded_name?: string; // Precomputed for search performance
  unit: string;
  gst_rate: number;
  hsn_code: string | null;
  is_active: boolean;
}

const ledgersMap = new Map<string, CachedLedger>();
const itemsMap = new Map<string, CachedItem>();
let ledgersSorted: CachedLedger[] = [];
let itemsSorted: CachedItem[] = [];
let currentCompanyId: string | null = null;

let version = 0;
const listeners = new Set<() => void>();
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

function bump() {
  version++;
  if (searchWorker) {
    searchWorker.postMessage({
      type: "SET_DATA",
      payload: { ledgers: ledgersSorted, items: itemsSorted },
    });
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
function getVersion() { return version; }

function fold(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, ""); }

function rebuildSorted() {
  ledgersSorted = Array.from(ledgersMap.values()).filter((l) => l.is_active !== false).sort((a, b) => a.name.localeCompare(b.name));
  itemsSorted = Array.from(itemsMap.values()).filter((i) => i.is_active !== false).sort((a, b) => a.name.localeCompare(b.name));
}

function debouncedRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildSorted();
    bump();
    rebuildTimer = null;
  }, 16); // ~1 frame delay
}

export function getLedger(id: string | null | undefined): CachedLedger | undefined { return id ? ledgersMap.get(id) : undefined; }
export function getItem(id: string | null | undefined): CachedItem | undefined { return id ? itemsMap.get(id) : undefined; }
export function getAllLedgers(): CachedLedger[] { return ledgersSorted; }
export function getAllItems(): CachedItem[] { return itemsSorted; }

export function searchLedgers(query: string, predicate?: (l: CachedLedger) => boolean, limit = 50): CachedLedger[] {
  const q = fold(query.trim());
  const src = predicate ? ledgersSorted.filter(predicate) : ledgersSorted;
  if (!q) return src.slice(0, limit);
  const prefix: CachedLedger[] = [];
  const contains: CachedLedger[] = [];
  for (const l of src) {
    if (!l._folded_name) l._folded_name = fold(l.name);
    const n = l._folded_name;
    if (n.startsWith(q)) prefix.push(l);
    else if (n.includes(q)) contains.push(l);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

export function searchItems(query: string, predicate?: (i: CachedItem) => boolean, limit = 50): CachedItem[] {
  const q = fold(query.trim());
  const src = predicate ? itemsSorted.filter(predicate) : itemsSorted;
  if (!q) return src.slice(0, limit);
  const prefix: CachedItem[] = [];
  const contains: CachedItem[] = [];
  for (const it of src) {
    if (!it._folded_name) it._folded_name = fold(it.name);
    const n = it._folded_name;
    if (n.startsWith(q)) prefix.push(it);
    else if (n.includes(q)) contains.push(it);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

export function useMastersVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

interface Ctx { ready: boolean; loading: boolean; reload: () => Promise<void>; }
const MastersCtx = createContext<Ctx>({ ready: false, loading: false, reload: async () => undefined });

async function fetchAll<T>(table: "ledgers" | "items", companyId: string, columns: string): Promise<T[]> {
  if (isLocalOnlyMode() || shouldPreferOfflineCache()) {
    return (table === "ledgers" ? await readLedgers(companyId) : await readItems(companyId)) as T[];
  }
  const PAGE = 1000;
  let from = 0;
  const out: T[] = [];
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).eq("company_id", companyId).order("name").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export function MastersProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompany();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(0);

  const reload = useCallback(async () => {
    if (!activeCompanyId) {
      ledgersMap.clear(); itemsMap.clear(); rebuildSorted();
      currentCompanyId = null; bump(); setReady(false); return;
    }
    const token = ++cancelRef.current;
    setLoading(true);
    try {
      const [lg, it] = await Promise.all([
        fetchAll<CachedLedger>("ledgers", activeCompanyId, "id, name, type, state_code, gstin, gst_treatment, is_active"),
        fetchAll<CachedItem>("items", activeCompanyId, "id, name, unit, gst_rate, hsn_code, is_active"),
      ]);
      if (token !== cancelRef.current) return;
      ledgersMap.clear(); itemsMap.clear();
      for (const l of lg) ledgersMap.set(l.id, l);
      for (const i of it) itemsMap.set(i.id, i);
      rebuildSorted();
      currentCompanyId = activeCompanyId;
      bump();
      setReady(true);
    } catch (e) {
      try {
        const [lg, it] = await Promise.all([readLedgers(activeCompanyId), readItems(activeCompanyId)]);
        if (token !== cancelRef.current) return;
        ledgersMap.clear(); itemsMap.clear();
        for (const l of lg as CachedLedger[]) ledgersMap.set(l.id, l);
        for (const i of it as CachedItem[]) itemsMap.set(i.id, i);
        rebuildSorted();
        currentCompanyId = activeCompanyId;
        bump();
        setReady(true);
      } catch (cacheErr) {
        console.error("[masters-cache] load failed", e, cacheErr);
      }
    } finally {
      if (token === cancelRef.current) setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const onRestored = () => { void reload(); };
    window.addEventListener("ym:local-data-restored", onRestored);
    return () => window.removeEventListener("ym:local-data-restored", onRestored);
  }, [reload]);

  useEffect(() => {
    if (!activeCompanyId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const ch = supabase.channel(`masters-${activeCompanyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ledgers", filter: `company_id=eq.${activeCompanyId}` }, (payload: any) => {
        const row = (payload.new ?? payload.old) as CachedLedger | undefined;
        if (!row) return;
        if (payload.eventType === "DELETE") ledgersMap.delete(row.id);
        else {
          const l = payload.new as CachedLedger;
          l._folded_name = fold(l.name);
          ledgersMap.set(l.id, l);
        }
        debouncedRebuild();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `company_id=eq.${activeCompanyId}` }, (payload: any) => {
        const row = (payload.new ?? payload.old) as CachedItem | undefined;
        if (!row) return;
        if (payload.eventType === "DELETE") itemsMap.delete(row.id);
        else {
          const i = payload.new as CachedItem;
          i._folded_name = fold(i.name);
          itemsMap.set(i.id, i);
        }
        debouncedRebuild();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeCompanyId]);

  return <MastersCtx.Provider value={{ ready, loading, reload }}>{children}</MastersCtx.Provider>;
}

export function useMasters() { return useContext(MastersCtx); }

export function upsertCachedLedger(l: CachedLedger) { 
  l._folded_name = fold(l.name);
  ledgersMap.set(l.id, l); 
  debouncedRebuild(); 
}
export function upsertCachedItem(i: CachedItem) { 
  i._folded_name = fold(i.name);
  itemsMap.set(i.id, i); 
  debouncedRebuild(); 
}
export function removeCachedLedger(id: string) { ledgersMap.delete(id); debouncedRebuild(); }
export function removeCachedItem(id: string) { itemsMap.delete(id); debouncedRebuild(); }
export function getCurrentCompanyId() { return currentCompanyId; }
