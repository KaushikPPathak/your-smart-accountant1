import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
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

export function CompanySwitcher() {
  const { memberships, activeMembership, setActiveCompanyId } = useCompany();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleCompanyPick = (companyId: string) => {
    setActiveCompanyId(companyId);
    navigate({ to: "/app" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 min-w-[180px] justify-between">
          <div className="flex items-center gap-2 truncate">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-sm font-medium">
              {activeMembership?.companies.name ?? t("company.noneShort")}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
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
