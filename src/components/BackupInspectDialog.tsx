/**
 * BackupInspectDialog
 *
 * Pick a .laccbak / .json backup file. As soon as the file is chosen, the
 * dialog runs a full integrity + structural inspection and shows a preview
 * of exactly what will be restored:
 *   - envelope format, schema version, exported timestamp, size
 *   - signed-checksum status (✓ / ✗ / legacy)
 *   - per-company breakdown: name, GSTIN/PAN, ledger/item/voucher counts,
 *     voucher date range, any structural issues
 * The Restore button is DISABLED until the inspection is green. A checksum
 * mismatch requires an explicit "I understand" toggle before it can proceed.
 *
 * On confirm, the file is restored INTO the currently-active company
 * (wipes and replaces), after saving a 24h pre-restore safety snapshot.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion,
  CheckCircle2, AlertTriangle, XCircle, FileText, CalendarClock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  inspectBackupFile, formatBytes, type InspectionReport,
} from "@/lib/backup-inspect";
import { restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
import { savePreRestoreSnapshot } from "@/lib/restore-safety";
import { runSemanticChecks } from "@/lib/semantic-checks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetCompanyId: string | null;
  targetCompanyName: string;
  isAdmin: boolean;
  onDone?: () => void;
}

export function BackupInspectDialog({
  open, onOpenChange, targetCompanyId, targetCompanyName, isAdmin, onDone,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<InspectionReport | null>(null);
  const [pickedIndex, setPickedIndex] = useState<number>(0);
  const [overrideChecksum, setOverrideChecksum] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [restoring, setRestoring] = useState(false);

  const reset = useCallback(() => {
    setReport(null);
    setPickedIndex(0);
    setOverrideChecksum(false);
    setConfirmName("");
    setScanning(false);
    setRestoring(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const onFile = async (file: File) => {
    reset();
    setScanning(true);
    try {
      const r = await inspectBackupFile(file);
      setReport(r);
      if (r.errors.length > 0) {
        toast.error("Backup failed integrity check — see details.");
      } else if (r.warnings.length > 0) {
        toast.warning("Backup readable — some warnings, see details.");
      } else {
        toast.success("Backup verified.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setScanning(false);
    }
  };

  const picked: CompanyBackup | null = (() => {
    if (!report) return null;
    if (report.raw.kind === "single") return report.raw.data;
    return report.raw.data.companies[pickedIndex] ?? null;
  })();
  const pickedPreview = report?.companies[pickedIndex] ?? null;

  const checksumBlocks =
    report?.checksumOk === false && !overrideChecksum;
  const nameMatches = confirmName.trim() === targetCompanyName;
  const canRestore =
    !!report &&
    !!picked &&
    report.errors.filter((_e) => !checksumBlocks).length === 0 &&
    !checksumBlocks &&
    !!targetCompanyId &&
    isAdmin &&
    nameMatches &&
    !restoring &&
    !scanning;

  const doRestore = async () => {
    if (!report || !picked || !targetCompanyId) return;
    if (!isAdmin) { toast.error("Only admins can restore."); return; }
    setRestoring(true);
    try {
      const snap = await savePreRestoreSnapshot(targetCompanyId, targetCompanyName);
      if (!snap.ok) {
        toast.warning("Could not create safety snapshot — proceeding without undo option.");
      }
      const summary = await restoreCompanyBackup(targetCompanyId, picked, { wipeExisting: true });
      toast.success(
        `Restored into "${targetCompanyName}": ${summary.ledgers} ledgers, ${summary.items} items, ${summary.vouchers} vouchers`,
      );
      try {
        const rep = await runSemanticChecks(targetCompanyId);
        if (rep.hasError) toast.error(`Verified with CRITICAL issues: ${rep.summary}`, { duration: 12000 });
        else if (rep.hasWarning) toast.warning(`Verified: ${rep.summary}`, { duration: 8000 });
        else toast.success(`Verified — ${rep.summary}`);
      } catch {
        toast.warning("Restored, but post-restore verification could not run.");
      }
      onDone?.();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Inspect &amp; restore backup
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File picker */}
          <div className="space-y-2">
            <Label className="text-xs">Backup file (.laccbak or .json)</Label>
            <Input
              ref={fileRef}
              type="file"
              accept=".laccbak,.json,application/json,application/octet-stream"
              disabled={scanning || restoring}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {scanning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Verifying signature and scanning contents…
              </div>
            )}
          </div>

          {report && (
            <div className="space-y-3">
              {/* Integrity summary */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{report.fileName}</span>
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
                      <ShieldAlert className="h-3 w-3" /> Checksum MISMATCH
                    </Badge>
                  )}
                  {report.checksumOk === null && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ShieldQuestion className="h-3 w-3" /> Legacy (no checksum)
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    schema v{report.schemaVersion}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {report.kind === "multi" ? "all companies" : "single company"}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  Exported {report.exportedAt ? new Date(report.exportedAt).toLocaleString() : "unknown"}
                  {" · "}
                  {report.companyCount} company/companies · {report.totals.ledgers} ledgers,{" "}
                  {report.totals.items} items, {report.totals.vouchers} vouchers
                </div>
                {report.errors.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-destructive">
                    {report.errors.map((e, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {e}
                      </li>
                    ))}
                  </ul>
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

              {/* Company chooser (multi only) */}
              {report.kind === "multi" && report.companies.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Company to restore</Label>
                  <Select
                    value={String(pickedIndex)}
                    onValueChange={(v) => setPickedIndex(Number(v))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {report.companies.map((c) => (
                        <SelectItem key={c.index} value={String(c.index)}>
                          {c.name} — {c.vouchers} vouchers
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Preview card for the picked company */}
              {pickedPreview && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                  <div className="text-sm font-medium">{pickedPreview.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {pickedPreview.gstin ? `GSTIN ${pickedPreview.gstin}` : "No GSTIN"}
                    {pickedPreview.pan ? ` · PAN ${pickedPreview.pan}` : ""}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Stat label="Ledgers" value={pickedPreview.ledgers} />
                    <Stat label="Items" value={pickedPreview.items} />
                    <Stat label="Vouchers" value={pickedPreview.vouchers} />
                    <Stat label="Voucher lines" value={pickedPreview.voucherItems} />
                    <Stat label="GL entries" value={pickedPreview.voucherEntries} />
                    <Stat
                      label="Date range"
                      value={
                        pickedPreview.dateRange.from && pickedPreview.dateRange.to
                          ? `${pickedPreview.dateRange.from} → ${pickedPreview.dateRange.to}`
                          : "—"
                      }
                    />
                  </div>
                  {pickedPreview.issues.length > 0 && (
                    <ScrollArea className="max-h-24 mt-1">
                      <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
                        {pickedPreview.issues.map((iss, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {iss}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  )}
                </div>
              )}

              {/* Checksum override */}
              {report.checksumOk === false && (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  <Checkbox
                    checked={overrideChecksum}
                    onCheckedChange={(v) => setOverrideChecksum(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand the checksum does not match. The file may be
                    corrupted or tampered with — restore anyway.
                  </span>
                </label>
              )}

              {/* Destination confirmation */}
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-destructive shrink-0" />
                  <div className="flex-1">
                    This will <strong>permanently replace</strong> all current
                    data in <strong>{targetCompanyName || "the active company"}</strong>{" "}
                    with the contents above. A pre-restore snapshot is saved
                    automatically (24h undo).
                    {!isAdmin && (
                      <div className="mt-1 text-destructive">
                        Only admins can restore.
                      </div>
                    )}
                  </div>
                </div>
                <Input
                  placeholder={`Type "${targetCompanyName}" to confirm`}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={!isAdmin || !targetCompanyId}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => { onOpenChange(false); reset(); }}
            disabled={restoring}
          >
            Cancel
          </Button>
          <Button onClick={doRestore} disabled={!canRestore}>
            {restoring
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring…</>
              : <>Restore</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-background/60 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-medium truncate">{value}</div>
    </div>
  );
}
