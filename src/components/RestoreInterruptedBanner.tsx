// Round 3 — Boot-time recovery for interrupted restores.
//
// If the previous session died in the middle of restoreCompanyBackup (power
// cut, tab crash, OS kill), the localStorage journal flag survives. This
// banner appears on next boot, explains what happened, and offers one
// click to roll the company back to the pre-restore snapshot captured
// just before the interrupted attempt.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Undo2, X, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getInterruptedRestore, endRestoreJournal, undoRestore,
  type RestoreJournalEntry,
} from "@/lib/restore-safety";

export function RestoreInterruptedBanner() {
  const [entry, setEntry] = useState<RestoreJournalEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Small delay so the workspace paints first and Dexie has settled.
    const id = window.setTimeout(() => {
      setEntry(getInterruptedRestore());
    }, 250);
    return () => window.clearTimeout(id);
  }, []);

  if (!entry) return null;

  const startedAgo = Math.max(1, Math.round((Date.now() - entry.startedAt) / 60_000));
  const label = entry.companyName ?? "the company";

  async function onRecover() {
    if (!entry) return;
    setBusy(true);
    try {
      await undoRestore(entry.companyId);
      endRestoreJournal();
      toast.success(`Recovered "${label}" from the pre-restore safety snapshot.`);
      setEntry(null);
      // Full reload so every provider re-reads IndexedDB from a clean slate.
      window.setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      endRestoreJournal(); // avoid boot loop
      toast.error(
        `Recovery failed: ${(e as Error).message ?? "unknown"}. ` +
        `The safety snapshot may have expired (24h) or been cleared.`,
        { duration: 12000 },
      );
      setEntry(null);
    } finally {
      setBusy(false);
    }
  }

  function onDismiss() {
    endRestoreJournal();
    toast.message("Interrupted-restore notice dismissed.", {
      description: "Verify your books look right. If not, use Housekeeping → Restore.",
    });
    setEntry(null);
  }

  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            The last restore did not finish
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                We started restoring <strong>{label}</strong> about {startedAgo} min
                ago but the app was closed before it could complete. Your data
                should have rolled back automatically, but we can also roll{" "}
                <strong>{label}</strong> back to the safety snapshot taken just
                before the restore.
              </p>
              <p className="text-xs text-muted-foreground">
                Kind: {entry.kind} · Company ID: <code>{entry.companyId.slice(0, 8)}…</code>
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss} disabled={busy}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Dismiss (data looks fine)
          </AlertDialogCancel>
          <AlertDialogAction onClick={onRecover} disabled={busy}>
            {busy ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Recovering…</>
            ) : (
              <><Undo2 className="mr-1.5 h-3.5 w-3.5" /> Recover from safety snapshot</>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
