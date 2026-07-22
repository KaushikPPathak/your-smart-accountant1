/**
 * RestoreNowButton
 *
 * Icon-only button that sits next to BackupNowButton in the top menu.
 * Clicking it opens a small dialog offering two restore paths:
 *
 *   1. "Restore latest local snapshot" — auto-picks the newest verified
 *      snapshot for the ACTIVE company from the default local snapshots
 *      folder, shows a preview (company name, counts, exported-at,
 *      checksum status), and requires an explicit Confirm.
 *
 *   2. "Choose another file…" — opens the existing BackupInspectDialog
 *      for a fully user-picked file with full inspection.
 *
 * A pre-restore safety snapshot is always taken (24h undo).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DatabaseZap, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion,
  FolderOpen, CalendarClock, FileText, CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import restoreMedallion from "@/assets/restore-medallion.png";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/lib/company-context";
import { isDesktopRuntime } from "@/lib/native-bridge";
import { listSnapshotsForCompany, type SnapshotCandidate } from "@/lib/auto-restore";
import {
  inspectBackupFile, formatBytes, type InspectionReport,
} from "@/lib/backup-inspect";
import { restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
import { savePreRestoreSnapshot } from "@/lib/restore-safety";
import { runSemanticChecks } from "@/lib/semantic-checks";
import { BackupInspectDialog } from "@/components/BackupInspectDialog";

export function RestoreNowButton() {
  const { activeMembership } = useCompany();
  const [open, setOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [latest, setLatest] = useState<SnapshotCandidate | null>(null);
  const [report, setReport] = useState<InspectionReport | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [restoring, setRestoring] = useState(false);

  const companyId = activeMembership?.company_id ?? null;
  const companyName = activeMembership?.companies.name ?? "";
  const isAdmin = activeMembership?.role === "admin";

  const reset = useCallback(() => {
    setLatest(null);
    setReport(null);
    setConfirmName("");
    setScanning(false);
    setRestoring(false);
  }, []);

  // When dialog opens, scan the default local snapshots folder and
  // pre-load the newest one so the user gets an instant preview.
  useEffect(() => {
    if (!open || !companyName) return;
    let cancelled = false;
    void (async () => {
      reset();
      setScanning(true);
      try {
        if (!isDesktopRuntime()) {
          toast.info("Default location isn't available in the browser — use Choose another file.");
          return;
        }
        const list = await listSnapshotsForCompany(companyName);
        if (cancelled) return;
        if (list.length === 0) {
          toast.warning("No local snapshots found for this company yet.");
          return;
        }
        const newest = list[0];
        setLatest(newest);
        // Read + inspect the file to build a preview.
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const text = await readTextFile(newest.absPath);
        const file = new File([text], newest.fileName, { type: "application/json" });
        const r = await inspectBackupFile(file);
        if (!cancelled) setReport(r);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not scan snapshots.");
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, companyName, reset]);

  if (!activeMembership) return null;

  const picked: CompanyBackup | null = (() => {
    if (!report) return null;
    if (report.raw.kind === "single") return report.raw.data;
    return report.raw.data.companies[0] ?? null;
  })();
  const preview = report?.companies[0] ?? null;

  const CHECKSUM_ERR = "Signed checksum";
  const hardErrors = (report?.errors ?? []).filter((e) => !e.startsWith(CHECKSUM_ERR));
  const checksumBad = report?.checksumOk === false;
  const nameMatches = confirmName.trim() === companyName;
  const canRestore =
    !!report && !!picked && !hardErrors.length && !checksumBad &&
    isAdmin && nameMatches && !restoring && !scanning;

  const doRestore = async () => {
    if (!report || !picked || !companyId) return;
    if (!isAdmin) { toast.error("Only admins can restore."); return; }
    setRestoring(true);
    try {
      const snap = await savePreRestoreSnapshot(companyId, companyName);
      if (!snap.ok) toast.warning("Could not create safety snapshot — proceeding without undo.");
      const summary = await restoreCompanyBackup(companyId, picked, { wipeExisting: true });
      toast.success(
        `Restored "${companyName}": ${summary.ledgers} ledgers, ${summary.items} items, ${summary.vouchers} vouchers`,
      );
      try {
        const rep = await runSemanticChecks(companyId);
        if (rep.hasError) toast.error(`Verified with CRITICAL issues: ${rep.summary}`, { duration: 12000 });
        else if (rep.hasWarning) toast.warning(`Verified: ${rep.summary}`, { duration: 8000 });
        else toast.success(`Verified — ${rep.summary}`);
      } catch { /* ignore */ }
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label={`Restore ${companyName} from backup`}
            className="relative h-9 w-9 rounded-md hover:bg-foreground/10"
          >
            <img
              src={restoreMedallion}
              alt=""
              aria-hidden
              className="h-7 w-7 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              draggable={false}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Restore {companyName}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DatabaseZap className="h-5 w-5 text-primary" />
              Restore {companyName}
            </DialogTitle>
            <DialogDescription>
              Restore from the newest local snapshot, or pick another file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {scanning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning default snapshot folder…
              </div>
            )}

            {!scanning && latest && report && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{latest.fileName}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {formatBytes(report.sizeBytes)}
                  </Badge>
                  {report.checksumOk === true && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" /> Checksum valid
                    </Badge>
                  )}
                  {report.checksumOk === false && (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <ShieldAlert className="h-3 w-3" /> Checksum mismatch
                    </Badge>
                  )}
                  {report.checksumOk === null && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ShieldQuestion className="h-3 w-3" /> Legacy
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  Exported {report.exportedAt ? new Date(report.exportedAt).toLocaleString() : "unknown"}
                  {" · "}snapshot folder {latest.dateFolder}
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  {preview?.name ?? "—"} · {report.totals.ledgers} ledgers ·{" "}
                  {report.totals.items} items · {report.totals.vouchers} vouchers
                </div>
                {hardErrors.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-destructive">
                    {hardErrors.map((e, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {e}
                      </li>
                    ))}
                  </ul>
                )}
                {checksumBad && (
                  <div className="text-[11px] text-destructive flex items-start gap-1.5">
                    <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    Checksum failed — use Choose another file to override with an explicit acknowledgement.
                  </div>
                )}
                {report.warnings.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
                    {report.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                      </li>
                    ))}
                  </ul>
                )}
                {report.ok && report.warnings.length === 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> All integrity checks passed.
                  </div>
                )}
              </div>
            )}

            {!scanning && !latest && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                No snapshot found in the default local folder. Use{" "}
                <strong>Choose another file…</strong> to browse.
              </div>
            )}

            {report && !hardErrors.length && !checksumBad && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-destructive shrink-0" />
                  <div className="flex-1">
                    This will <strong>permanently replace</strong> all current data in{" "}
                    <strong>{companyName}</strong>. A pre-restore snapshot is saved (24h undo).
                    {!isAdmin && (
                      <div className="mt-1 text-destructive">Only admins can restore.</div>
                    )}
                  </div>
                </div>
                <Input
                  placeholder={`Type "${companyName}" to confirm`}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => { setOpen(false); setPickOpen(true); }}
              disabled={restoring}
            >
              Choose another file…
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={restoring}>
                Cancel
              </Button>
              <Button onClick={doRestore} disabled={!canRestore}>
                {restoring
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring…</>
                  : <>Restore latest</>}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BackupInspectDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        targetCompanyId={companyId}
        targetCompanyName={companyName}
        isAdmin={isAdmin}
      />
    </>
  );
}
