/**
 * UpdateRollbackBanner
 *
 * Shown for the first launches after the app version changed. It tells the
 * user, in plain language, that they can go back to the version they were
 * using before — their data stays exactly where it is, because business
 * data lives in the local data folder, not inside the program folder.
 *
 * It also lets them stay on the current version (opt out of updates), so a
 * build they are happy with is effectively "locked in".
 */
import { useEffect, useState } from "react";
import { History, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getRollbackOffer,
  dismissRollbackOffer,
  setAutoUpdateOptOut,
  type RollbackOffer,
} from "@/lib/update-safety";

export function UpdateRollbackBanner() {
  const [offer, setOffer] = useState<RollbackOffer | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    setOffer(getRollbackOffer());
  }, []);

  if (!offer) return null;

  const dismiss = () => {
    dismissRollbackOffer();
    setOffer(null);
  };

  const keepThisVersion = () => {
    setAutoUpdateOptOut(true);
    dismissRollbackOffer();
    setOffer(null);
    toast.success(`Staying on version ${offer.toVersion}`, {
      description: "This device will not be moved to a newer version automatically.",
    });
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-1.5 text-xs text-foreground"
        role="status"
      >
        <History className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">
          Updated from version <strong>{offer.fromVersion}</strong> to{" "}
          <strong>{offer.toVersion}</strong>. If anything does not work the way it
          did before, you can go back to the previous version — your books stay
          untouched.
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1.5 px-2 text-[11px]"
            onClick={() => setHowOpen(true)}
          >
            <History className="h-3 w-3" /> Go back to {offer.fromVersion}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1.5 px-2 text-[11px]"
            onClick={keepThisVersion}
          >
            <ShieldCheck className="h-3 w-3" /> Keep this version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            className="h-6 px-1.5 text-[11px]"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </span>
      </div>

      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Go back to version {offer.fromVersion}</DialogTitle>
            <DialogDescription>
              Your companies, vouchers and settings are stored outside the program
              folder, so switching versions never deletes them.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <strong>Going back is not one click.</strong> Windows (including Windows 7 and 10) does not allow a
            running program to uninstall itself and install an older version
            automatically, so you need to run the previous installer yourself.
          </div>

          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Click <strong>Backup</strong> in the top bar — one click, just to be
              safe.
            </li>
            <li>
              Close this app completely.
            </li>
            <li>
              Uninstall version {offer.toVersion} from Windows{" "}
              <em>Apps &amp; features</em>. Choose <strong>Uninstall</strong> only —
              do not delete the data folder if you are asked.
            </li>
            <li>
              Run the installer for version {offer.fromVersion} again.
              <p className="mt-1 text-xs font-medium text-primary">
                If you don't have the previous installer, you can download it from your 
                order history or the "Previous Versions" link on our website.
              </p>
            </li>
            <li>
              Start the app. Your data is picked up automatically; if anything is
              missing, it is restored from the local snapshots on first launch.
            </li>
          </ol>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <strong>Keep this version</strong> is a single click. It stops the device
            from receiving future automatic updates, so the current build stays
            exactly as it is.
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => setHowOpen(false)}>
              Close
            </Button>
            <Button onClick={keepThisVersion}>Stay on {offer.toVersion}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
