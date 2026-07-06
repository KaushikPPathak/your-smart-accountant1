/**
 * DataOwnershipDialog
 *
 * Blocking first-run modal that makes the user aware — before they type a
 * single voucher — that their business data lives ONLY on this device.
 * Uninstalling the app, reinstalling, clearing browser storage, or moving
 * to another PC will start empty unless they have a backup file.
 *
 * The user must tick "I understand" and click Continue. The acknowledgement
 * is stored in localStorage under `ym_data_ownership_ack_v1`. If the flag
 * is missing (fresh install, cleared storage, new device), the dialog
 * re-appears — which is exactly the safety net the user asked for.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, HardDrive, HardDriveDownload, Cloud } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const ACK_KEY = "ym_data_ownership_ack_v1";

export function hasAcknowledgedDataOwnership(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

export function DataOwnershipDialog() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasAcknowledgedDataOwnership()) {
      // Slight delay so it appears after first paint, not during it.
      const id = window.setTimeout(() => setOpen(true), 400);
      return () => window.clearTimeout(id);
    }
  }, []);

  const onContinue = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* modal — can't dismiss without ack */ }}>
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Please read — your data lives on this device
          </DialogTitle>
          <DialogDescription>
            Before you start entering vouchers, we need you to understand how
            your data is stored on this installation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              Every company, voucher, ledger, item and setting you create is
              saved <strong>only on this computer</strong>. Nothing about your
              business is uploaded to our servers.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                A fresh install starts empty.
              </p>
              <p className="mt-1 text-destructive/90">
                If you uninstall the app, clear browser data, use a different
                browser or PC, or reinstall Windows — this device&apos;s data
                will be gone <strong>unless you have a backup file</strong>.
                We cannot recover it for you.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              Take a backup regularly from{" "}
              <strong>Housekeeping → Backup &amp; Restore</strong>, or connect
              your own <Cloud className="inline h-3.5 w-3.5" /> Google Drive /
              OneDrive / Dropbox from{" "}
              <strong>Settings → Cloud backup</strong> for one-click uploads.
            </p>
          </div>
        </div>

        <label className="mt-2 flex items-start gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5"
          />
          <span>
            I understand my data is on this device only, and I&apos;m
            responsible for taking my own backups.
          </span>
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline">
            <Link
              to="/app/housekeeping"
              search={{ tab: "backup" } as never}
              onClick={onContinue}
            >
              Take my first backup now
            </Link>
          </Button>
          <Button onClick={onContinue} disabled={!checked}>
            I understand — continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
