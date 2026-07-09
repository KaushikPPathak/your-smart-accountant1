import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { rememberActiveCompanyName } from "./desktop-save";
import type { EntityStatus } from "./entity-status";
import { setCurrentCurrency } from "./currency";
import { setCurrentDateFormat, type DateFormatCode } from "./date-format";
import { getActiveStaff } from "./staff-session";
import { isOnlineNow } from "./offline/online-status";
import { isLocalOnlyMode } from "./local-only-mode";
import { normalizeCompany } from "./offline/cache-normalizers";

export interface CompanyMembership {
  company_id: string;
  role: "admin" | "accountant" | "viewer";
  companies: {
    id: string;
    name: string;
    gstin: string | null;
    state: string | null;
    state_code: string | null;
    financial_year_start: string;
    gst_registered: boolean;
    gst_filing_frequency: "monthly" | "quarterly" | "iff";
    inventory_enabled: boolean;
    annual_turnover_paise: number;
    mode: "normal" | "trial_local";
    entity_status: EntityStatus;
    cin: string | null;
    share_capital_paise: number;
    corpus_fund_paise: number;
    currency_code: string | null;
    date_format: DateFormatCode | null;
  };
}

interface CompanyContextValue {
  loading: boolean;
  memberships: CompanyMembership[];
  activeCompanyId: string | null;
  activeMembership: CompanyMembership | null;
  setActiveCompanyId: (id: string) => void;
  refresh: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);
const ACTIVE_KEY = "ym_active_company_id";
const FULL_SNAPSHOT_THROTTLE_MS = 10 * 60 * 1000;
const fullSnapshotKey = (companyId: string) => `ym_full_snapshot_at:${companyId}`;

const COMPANY_DEFAULTS: Omit<CompanyMembership["companies"], "id" | "name"> = {
  gstin: null,
  state: null,
  state_code: null,
  financial_year_start: new Date().getFullYear() + "-04-01",
  gst_registered: false,
  gst_filing_frequency: "monthly",
  inventory_enabled: false,
  annual_turnover_paise: 0,
  mode: "trial_local",
  entity_status: "individual",
  cin: null,
  share_capital_paise: 0,
  corpus_fund_paise: 0,
  currency_code: "INR",
  date_format: "dd-mm-yyyy",
};

function mapCompanyRowToMembership(
  companyId: string,
  role: CompanyMembership["role"] | string | null | undefined,
  company: Record<string, any>,
): CompanyMembership | null {
  const id = String(company?.id ?? companyId ?? "");
  const name = String(company?.name ?? "").trim();
  if (!id || !name) return null;
  // Merge defaults first, then the cached row on top, then run the
  // self-healing normalizer so old rows (written before newer columns
  // existed) don't silently poison flags like gst_registered.
  const merged = { ...COMPANY_DEFAULTS, ...(company as any), id, name } as any;
  // Lazy require to avoid a circular import at module init.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { normalizeCompany } = require("./offline/cache-normalizers") as typeof import("./offline/cache-normalizers");
  const normalized = normalizeCompany(merged) ?? merged;
  return {
    company_id: id,
    role: (role || "admin") as CompanyMembership["role"],
    companies: normalized as CompanyMembership["companies"],
  };
}

async function loadCachedMemberships(): Promise<CompanyMembership[]> {
  try {
    const { offlineDb } = await import("./offline/db");
    const [snapshotCompanies, pickerCompanies] = await Promise.all([
      offlineDb.cache_companies.toArray().catch(() => []),
      offlineDb.companies.toArray().catch(() => []),
    ]);

    const byId = new Map<string, Record<string, any>>();
    for (const row of pickerCompanies as Record<string, any>[]) {
      if (row?.id) byId.set(String(row.id), row);
    }
    for (const row of snapshotCompanies as Record<string, any>[]) {
      if (row?.id) byId.set(String(row.id), { ...(byId.get(String(row.id)) ?? {}), ...row });
    }

    return Array.from(byId.values())
      .map((company) => mapCompanyRowToMembership(String(company.id), company.role ?? "admin", company))
      .filter(Boolean) as CompanyMembership[];
  } catch (err) {
    console.warn("Failed to read cached companies:", err);
    return [];
  }
}

async function persistMembershipsToOfflineCache(list: CompanyMembership[]): Promise<void> {
  try {
    const { offlineDb } = await import("./offline/db");
    await Promise.all([
      offlineDb.cache_companies.bulkPut(
        list.map((m) => ({ ...m.companies, id: m.company_id, company_id: m.company_id, updated_at: (m.companies as any).updated_at ?? new Date().toISOString() })),
      ),
      offlineDb.companies.bulkPut(
        list.map((m) => ({ id: m.company_id, name: m.companies.name, has_password: Boolean((m.companies as any).has_password) })),
      ),
    ]);
  } catch {
    /* cache is best-effort */
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const activeStaff = getActiveStaff();
    const applyMemberships = (next: CompanyMembership[]) => {
      setMemberships(next);
      const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
      const valid = stored && next.find((m) => m.company_id === stored);
      setActiveCompanyIdState(valid ? stored : next[0]?.company_id ?? null);
    };

    // 1) INSTANT PAINT from Dexie cache — never block UI on the network.
    let paintedFromCache = false;
    try {
      const cached = await loadCachedMemberships();
      if (cached.length > 0) {
        applyMemberships(cached);
        paintedFromCache = true;
      }
    } catch { /* ignore */ }
    setLoading(false);

    // 2) Offline OR local-only? we're done — cloud company_members is
    // not authoritative and the fetch just produces aborted requests
    // (see runtime audit — 12 ERR_ABORTED on the picker).
    if (!isOnlineNow() || isLocalOnlyMode()) return;

    // 3) Reconcile with cloud in the background (batched, non-blocking).
    try {
      const { data: memberRows, error } = await supabase
        .from("company_members")
        .select("company_id, role")
        .order("created_at", { ascending: true });
      if (error) throw error;

      const rows = (memberRows ?? []) as Array<{ company_id: string; role: CompanyMembership["role"] }>;
      const ids = Array.from(new Set(rows.map((r) => r.company_id).filter(Boolean)));
      if (ids.length === 0) {
        if (!paintedFromCache) applyMemberships([]);
        return;
      }

      // Single batched fetch instead of N sequential .maybeSingle() calls.
      const { data: companies } = await supabase
        .from("companies")
        .select("*")
        .in("id", ids);

      const byId = new Map<string, any>();
      for (const c of (companies ?? []) as any[]) if (c?.id) byId.set(String(c.id), c);

      const out: CompanyMembership[] = [];
      for (const r of rows) {
        const c = byId.get(String(r.company_id));
        if (!c) continue;
        const mapped = mapCompanyRowToMembership(r.company_id, r.role, c);
        if (mapped) out.push(mapped);
      }

      const list = activeStaff
        ? out.filter((m) => {
            const ownerId = (m.companies as any)?.owner_app_user_id;
            return !ownerId || ownerId === activeStaff.id || ownerId === "offline-user-session";
          })
        : out;
      const finalValidList = list.length === 0 && out.length > 0 ? out : list;

      if (finalValidList.length > 0) {
        applyMemberships(finalValidList);
        void persistMembershipsToOfflineCache(finalValidList);
      } else if (!paintedFromCache) {
        applyMemberships([]);
      }
    } catch (err) {
      // Network hiccup — keep cached view; nothing else to do.
      if (!paintedFromCache) {
        console.warn("Company reconcile failed, using cache only:", err);
      }
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveCompanyId = (id: string) => {
    setActiveCompanyIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(ACTIVE_KEY, id);
  };

  const activeMembership = memberships.find((m) => m.company_id === activeCompanyId) ?? null;

  useEffect(() => {
    rememberActiveCompanyName(activeMembership?.companies?.name ?? null);
    const c = activeMembership?.companies;
    if (c) {
      if (c.currency_code) setCurrentCurrency(c.currency_code);
      if (c.date_format) setCurrentDateFormat(c.date_format);
    }
    // Lazy hydrate heavy per-company tables (ledgers, items, vouchers,
    // voucher children) on demand — the background tick only pulls the
    // minimum companies + settings dataset.
    if (activeCompanyId && isOnlineNow()) {
      const last = Number(localStorage.getItem(fullSnapshotKey(activeCompanyId)) ?? "0");
      if (!last || Date.now() - last > FULL_SNAPSHOT_THROTTLE_MS) {
        // Silent hydrate — no toasts, no banners. Sync stays a background
        // detail; the user only sees data, never plumbing.
        const hydrate = () => {
          import("@/lib/offline/snapshot")
            .then((m) => m.pullCompanySnapshot(activeCompanyId, { full: true, notify: false }))
            .then((result) => {
              if (result && Object.keys(result.errors).length === 0 && result.verification?.ok !== false) {
                localStorage.setItem(fullSnapshotKey(activeCompanyId), String(Date.now()));
              }
            })
            .catch(() => { /* swallow — offline/online is invisible to the user */ });
        };
        const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => void }).requestIdleCallback;
        if (idle) idle(hydrate, { timeout: 5_000 });
        else setTimeout(hydrate, 2_000);
      }
    }
  }, [activeMembership, activeCompanyId]);

  return (
    <CompanyContext.Provider
      value={{ loading, memberships, activeCompanyId, activeMembership, setActiveCompanyId, refresh }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used inside CompanyProvider");
  return ctx;
}
