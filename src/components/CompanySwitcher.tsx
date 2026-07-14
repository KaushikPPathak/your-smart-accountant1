import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/lib/company-context";
import { useI18n } from "@/lib/i18n";
import { isCompanyUnlocked, markCompanyUnlocked } from "@/lib/tech-user";
import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

export function CompanySwitcher() {
  const { memberships, activeMembership, setActiveCompanyId } = useCompany();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleCompanyPick = async (companyId: string) => {
    if (isCompanyUnlocked(companyId)) {
      setActiveCompanyId(companyId);
      return;
    }

    // Local-only/offline: company password state is local; never query cloud picker.
    if (isLocalOnlyMode() || !isOnlineNow()) {
      console.log("Offline mode: checking local hard drive cache for password protection state...");
      try {
        const { offlineDb } = await import("@/lib/offline/db");
        const localCompany = await offlineDb.companies.get(companyId);
        
        if (!localCompany || !localCompany.has_password) {
          // No password or not found locally, open directly in offline bypass mode
          markCompanyUnlocked(companyId);
          setActiveCompanyId(companyId);
          return;
        }
        
        // Needs password — bounce to start screen to prompt for it
        setActiveCompanyId(companyId);
        navigate({ to: "/" });
        return;
      } catch (err) {
        console.error("Failed to read local company state offline:", err);
        // Fallback safety: try to open anyway
        markCompanyUnlocked(companyId);
        setActiveCompanyId(companyId);
        return;
      }
    }

    // 🌐 ONLINE MODE: Original Supabase check
    const { data, error } = await supabase
      .from("companies_picker")
      .select("has_password")
      .eq("id", companyId)
      .maybeSingle();

    if (error) {
      toast.error(error.message);
      return;
    }

    if (!data?.has_password) {
      markCompanyUnlocked(companyId);
      setActiveCompanyId(companyId);
      return;
    }

    // Needs password — send user to picker to enter it
    setActiveCompanyId(companyId);
    navigate({ to: "/" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 min-w-[240px] max-w-[360px] justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">
              {activeMembership?.companies.name ?? t("company.noneShort")}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        {memberships.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">{t("company.noneYet")}</div>
        )}
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.company_id}
            onSelect={() => handleCompanyPick(m.company_id)}
            className="flex items-center justify-between"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{m.companies.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.role}
              </span>
            </div>
            {activeMembership?.company_id === m.company_id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/companies" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>{t("company.manage")}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
