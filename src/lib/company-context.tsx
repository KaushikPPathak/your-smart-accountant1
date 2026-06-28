import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { rememberActiveCompanyName } from "./desktop-save";
import type { EntityStatus } from "./entity-status";
import { setCurrentCurrency } from "./currency";
import { setCurrentDateFormat, type DateFormatCode } from "./date-format";
import { getActiveStaff } from "./staff-session";
import { isOnlineNow } from "./offline/online-status";

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
  return {
    company_id: id,
    role: (role || "admin") as CompanyMembership["role"],
    companies: {
      id,
      name,
      ...COMPANY_DEFAULTS,
      ...(company as any),
    } as CompanyMembership["companies"],
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
    setLoading(true);
    const activeStaff = getActiveStaff();
    const applyMemberships = (next: CompanyMembership[]) => {
      setMemberships(next);
      const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
      const valid = stored && next.find((m) => m.company_id === stored);
      setActiveCompanyIdState(valid ? stored : next[0]?.company_id ?? null);
    };

    const loadOfflineFirst = async () => {
      const cached = await loadCachedMemberships();
      if (cached.length > 0) applyMemberships(cached);
      return cached;
    };
    
    try {
      if (!isOnlineNow()) {
        await loadOfflineFirst();
        return;
      }

      // Safely process local mock execution records
      const response = await supabase
        .from("company_members")
        .select("company_id, role")
        .order("created_at", { ascending: true });
        
      const memberRows = response?.data;
      const error = response?.error;

      if (error) {
        console.error("Failed to load company memberships:", error);
        const cached = await loadOfflineFirst();
        if (cached.length === 0) applyMemberships([]);
      } else {
        const rows = (memberRows ?? []) as Array<{ company_id: string; role: CompanyMembership["role"] }>;
        const out: CompanyMembership[] = [];
        
        for (const r of rows) {
          if (!r.company_id) continue;

          const { data: company } = await supabase
            .from("companies")
            .select("*")
            .eq("id", r.company_id)
            .maybeSingle();
            
          if (!company || !company.id) continue;
          
          const mapped = mapCompanyRowToMembership(r.company_id, r.role, company as any);
          if (mapped) out.push(mapped);
        }

        // Defensive checks to preserve local datasets if no specific cloud constraints are present
        const list = activeStaff
          ? out.filter((m) => {
              const ownerId = (m.companies as any)?.owner_app_user_id;
              return !ownerId || ownerId === activeStaff.id || ownerId === 'offline-user-session';
            })
          : out;

        // If data exists locally but staff filters cleared them out incorrectly, retain full 'out' array layout as a safety net
        const finalValidList = list.length === 0 && out.length > 0 ? out : list;

        if (finalValidList.length > 0) {
          applyMemberships(finalValidList);
          void persistMembershipsToOfflineCache(finalValidList);
        } else {
          const cached = await loadOfflineFirst();
          if (cached.length === 0) applyMemberships([]);
        }
      }
    } catch (criticalRefreshError) {
      console.error("Mehtaji Pipeline: Integrity check failure during context mapping:", criticalRefreshError);
      const cached = await loadOfflineFirst();
      if (cached.length === 0) applyMemberships([]);
    } finally {
      setLoading(false);
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
    if (activeCompanyId) {
      import("@/lib/offline/snapshot")
        .then((m) => m.pullCompanySnapshot(activeCompanyId, { full: true }))
        .catch(() => undefined);
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
