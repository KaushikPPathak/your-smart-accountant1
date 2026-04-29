import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { rememberActiveCompanyName } from "./desktop-save";

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
    if (!user) {
      setMemberships([]);
      setActiveCompanyIdState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("company_members")
      .select("company_id, role, companies(id, name, gstin, state, state_code, financial_year_start, gst_registered, gst_filing_frequency)")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load companies:", error);
      setMemberships([]);
    } else {
      const list = (data ?? []) as unknown as CompanyMembership[];
      setMemberships(list);
      const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
      const valid = stored && list.find((m) => m.company_id === stored);
      setActiveCompanyIdState(valid ? stored : list[0]?.company_id ?? null);
    }
    setLoading(false);
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
