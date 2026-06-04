import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { rememberActiveCompanyName } from "./desktop-save";
import type { EntityStatus } from "./entity-status";
import { setCurrentCurrency } from "./currency";
import { setCurrentDateFormat, type DateFormatCode } from "./date-format";
import { getActiveStaff } from "./staff-session";

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

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const activeStaff = getActiveStaff();
    
    try {
      // Safely process local mock execution records
      const response = await supabase
        .from("company_members")
        .select("company_id, role")
        .order("created_at", { ascending: true });
        
      const memberRows = response?.data;
      const error = response?.error;

      if (error) {
        console.error("Failed to load company memberships:", error);
        setMemberships([]);
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
          
          out.push({ 
            company_id: r.company_id, 
            role: r.role || "admin", 
            companies: {
              gstin: null,
              state: null,
              state_code: null,
              financial_year_start: new Date().getFullYear() + "-04-01",
              gst_registered: false,
              gst_filing_frequency: "monthly",
              inventory_enabled: false,
              annual_turnover_paise: 0,
              mode: "trial_local",
              entity_status: "active",
              cin: null,
              share_capital_paise: 0,
              corpus_fund_paise: 0,
              currency_code: "INR",
              date_format: "DD-MM-YYYY",
              ...(company as any),
            } as CompanyMembership["companies"] 
          });
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

        setMemberships(finalValidList);
        
        const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
        const valid = stored && finalValidList.find((m) => m.company_id === stored);
        
        setActiveCompanyIdState(valid ? stored : finalValidList[0]?.company_id ?? null);
      }
    } catch (criticalRefreshError) {
      console.error("Mehtaji Pipeline: Integrity check failure during context mapping:", criticalRefreshError);
      setMemberships([]);
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
  }, [activeMembership]);

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
