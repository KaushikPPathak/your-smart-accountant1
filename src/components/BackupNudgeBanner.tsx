/**
 * BackupNudgeBanner
 *
 * Slim, dismissible banner shown at the top of the app shell when the
 * active company has not been backed up locally in a while. Reads
 * `lastBackup:<companyId>` from localStorage (written by BackupRestoreTool
 * and the in-header "Backup now" action) and compares against today.
 *
 * Behaviour:
 *   - Hidden if backup is fresh (< 7 days).
 *   - Amber banner at 7+ days (and when no backup is on record).
 *   - Red banner at 14+ days.
 *   - "Remind me later" hides it for 24 h via sessionStorage.
 *   - "Backup now" jumps to /app/housekeeping?tab=backup.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ShieldAlert, X, HardDriveDownload } from "lucide-react";
import { useCompany } from "@/lib/company-context";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

function readLastBackup(companyId: string): number | null {
  try {
    const raw = localStorage.getItem(`lastBackup:${companyId}`);
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function readSnooze(companyId: string): number | null {
  try {
    const raw = sessionStorage.getItem(`backupNudgeSnooze:${companyId}`);
    if (!raw) return null;
    const t = Number(raw);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export function BackupNudgeBanner() {
  const { activeCompanyId } = useCompany();
  const location = useLocation();
  // Bump on focus / storage events so the banner reacts after a backup is taken.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  if (!activeCompanyId) return null;
  // Don't pester the user while they're already on the backup tab.
  if (
    location.pathname.startsWith("/app/housekeeping") &&
    typeof location.search === "object" &&
    (location.search as { tab?: string }).tab === "backup"
  ) {
    return null;
  }

  void tick;
  const last = readLastBackup(activeCompanyId);
  const days =
    last === null ? null : Math.floor((Date.now() - last) / 86_400_000);
  const stale = days === null || days >= 7;
  if (!stale) return null;

  const snoozedUntil = readSnooze(activeCompanyId);
  if (snoozedUntil && Date.now() < snoozedUntil) return null;

  const severe = days !== null && days >= 14;
  const tone = severe
    ? "border-destructive/50 bg-destructive/10 text-destructive"
    : "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200";

  const onSnooze = () => {
    try {
      sessionStorage.setItem(
        `backupNudgeSnooze:${activeCompanyId}`,
        String(Date.now() + SNOOZE_MS),
      );
    } catch {
      /* ignore */
    }
    setTick((n) => n + 1);
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-xs ${tone}`}
      role="status"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        {days === null ? (
          <>No backup recorded for this company yet. Save one to a USB / external drive.</>
        ) : severe ? (
          <>
            Last backup was <strong>{days}</strong> days ago — overdue. Back up now.
          </>
        ) : (
          <>
            Last backup was <strong>{days}</strong> day{days === 1 ? "" : "s"} ago.
            We recommend at least every 7 days.
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button
          asChild
          size="sm"
          variant={severe ? "destructive" : "secondary"}
          className="h-6 gap-1.5 px-2 text-[11px]"
        >
          <Link
            to="/app/housekeeping"
            search={{ tab: "backup" } as never}
          >
            <HardDriveDownload className="h-3 w-3" /> Backup now
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onSnooze}
          className="h-6 px-1.5 text-[11px]"
          title="Remind me again in 24 hours"
          aria-label="Dismiss for 24 hours"
        >
          <X className="h-3 w-3" />
        </Button>
      </span>
    </div>
  );
}
