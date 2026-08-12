/**
 * UpdateRecoveryBanner
 *
 * Shows once after an app version update if the local IndexedDB is
 * unexpectedly empty (previously had companies, now has zero). The user
 * can either open Restore to load a snapshot / backup file, or dismiss
 * if they intentionally started fresh.
 *
 * The check is driven by update-safety.ts on launch; this component just
 * renders the outcome.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert, X, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isRecoveryRecommended,
  clearRecoveryFlag,
} from "@/lib/update-safety";

export function UpdateRecoveryBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isRecoveryRecommended());
  }, []);

  if (!show) return null;

  const onDismiss = () => {
    clearRecoveryFlag();
    setShow(false);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-destructive/50 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
      role="alert"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        After the update, no company data was found on this device. If this
        wasn&apos;t expected, restore your latest backup — your files in{" "}
        <code className="text-[10px]">%LOCALAPPDATA%\SmartAccountant\snapshots</code>{" "}
        or your linked cloud drive should still have it.
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button
          asChild
          size="sm"
          variant="destructive"
          className="h-6 gap-1.5 px-2 text-[11px]"
        >
          <Link
            to="/app/housekeeping"
            search={{ tab: "backup" } as never}
            onClick={onDismiss}
          >
            <HardDriveDownload className="h-3 w-3" /> Restore now
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="h-6 px-1.5 text-[11px]"
          title="Dismiss — I started fresh intentionally"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </span>
    </div>
  );
}
