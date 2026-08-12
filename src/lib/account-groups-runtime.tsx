import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { GROUP_BY_CODE, groupLabel as builtinLabel } from "@/lib/account-groups";

export interface Subgroup {
  id: string;
  parent_group_code: string;
  name: string;
}
export interface GroupOverride {
  group_code: string;
  label: string;
}

interface Ctx {
  subgroups: Subgroup[];
  overrides: Record<string, string>;
  reload: () => void;
  loading: boolean;
}

const AccountGroupsCtx = createContext<Ctx>({ subgroups: [], overrides: {}, reload: () => {}, loading: false });

export function AccountGroupsProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompany();
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) {
      setSubgroups([]); setOverrides({}); return;
    }
    setLoading(true);
    Promise.all([
      supabase.from("account_subgroups").select("id, parent_group_code, name").eq("company_id", activeCompanyId).order("name"),
      supabase.from("account_group_overrides").select("group_code, label").eq("company_id", activeCompanyId),
    ]).then(([sg, ov]) => {
      setSubgroups((sg.data || []) as Subgroup[]);
      const map: Record<string, string> = {};
      for (const r of (ov.data || []) as GroupOverride[]) map[r.group_code] = r.label;
      setOverrides(map);
      setLoading(false);
    });
  }, [activeCompanyId, tick]);

  const value = useMemo(() => ({ subgroups, overrides, loading, reload: () => setTick((t) => t + 1) }), [subgroups, overrides, loading]);
  return <AccountGroupsCtx.Provider value={value}>{children}</AccountGroupsCtx.Provider>;
}

export function useAccountGroups() {
  return useContext(AccountGroupsCtx);
}

/** Resolve a group code's label, applying per-company override if any. */
export function resolveGroupLabel(code: string | null | undefined, overrides: Record<string, string>): string {
  if (!code) return "Unclassified";
  return overrides[code] ?? builtinLabel(code) ?? code;
}

export function subgroupsFor(parentCode: string, all: Subgroup[]): Subgroup[] {
  return all.filter((s) => s.parent_group_code === parentCode);
}

export function isBuiltinGroup(code: string): boolean {
  return Boolean(GROUP_BY_CODE[code]);
}