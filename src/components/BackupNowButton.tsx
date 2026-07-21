import { useState } from "react";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompany } from "@/lib/company-context";
import { exportCompanyBackup } from "@/lib/backup";

/**
 * Small icon-only button that lives beside the CompanySwitcher in the top menu.
 * One click writes a fresh JSON snapshot of the active company to the user's
 * local backup folder (or Downloads in the browser).
 */
export function BackupNowButton() {
  const { activeMembership } = useCompany();
  const [busy, setBusy] = useState(false);

  if (!activeMembership) return null;
  const companyId = activeMembership.company_id;
  const companyName = activeMembership.companies.name;

  const runBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await exportCompanyBackup(companyId, companyName);
      toast.success("Backup saved", {
        description: r.desktopPath || r.fileName,
      });
      try {
        localStorage.setItem(`lastBackup:${companyId}`, new Date().toISOString());
      } catch {
        /* ignore */
      }
    } catch (err) {
      toast.error("Backup failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={runBackup}
          disabled={busy}
          aria-label={`Back up ${companyName} now`}
          className="relative h-9 w-9 rounded-md text-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <DatabaseBackup className="h-[18px] w-[18px]" />
          )}
          {!busy && (
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 rounded-sm bg-primary px-[3px] text-[8px] font-bold leading-[10px] text-primary-foreground shadow-sm"
            >
              B
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Backup {companyName} now</TooltipContent>
    </Tooltip>
  );
}
