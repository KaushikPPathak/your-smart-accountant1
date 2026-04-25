// Housekeeping tab: export full company backup to JSON; restore from JSON file.
import { useRef, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Upload, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  exportCompanyBackup, parseBackupFile, restoreCompanyBackup,
  type RestoreSummary,
} from "@/lib/backup";

interface Props {
  companyId: string;
  companyName: string;
  disabled: boolean;
}

export function BackupRestoreTool({ companyId, companyName, disabled }: Props) {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function doExport() {
    if (!companyId) return;
    setExporting(true);
    try {
      const r = await exportCompanyBackup(companyId, companyName);
      toast.success(`Backup saved: ${r.fileName}${r.desktopPath ? ` (${r.desktopPath})` : ""}`);
      try { localStorage.setItem(`lastBackup:${companyId}`, new Date().toISOString()); } catch { /* ignore */ }
    } catch (e) {
      toast.error((e as Error).message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function doRestore() {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      const text = await pendingFile.text();
      const parsed = parseBackupFile(text);
      if (parsed.kind !== "single") {
        toast.error("Multi-company backup detected. Please use a single-company backup file.");
        return;
      }
      const r = await restoreCompanyBackup(companyId, parsed.data, { wipeExisting: true });
      setSummary(r);
      toast.success("Restore complete");
    } catch (e) {
      toast.error((e as Error).message || "Restore failed");
    } finally {
      setRestoring(false);
      setConfirmOpen(false);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const lastBackup = (() => {
    try { return localStorage.getItem(`lastBackup:${companyId}`); } catch { return null; }
  })();
  const daysSince = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86_400_000)
    : null;
  const stale = daysSince !== null && daysSince >= 7;

  return (
    <div className="space-y-4">
      {(lastBackup === null || stale) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-2 p-3 text-xs">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            {lastBackup === null ? (
              <>No backup recorded yet for this company. Export one and save it to a USB / external drive.</>
            ) : (
              <>Last backup was <strong>{daysSince}</strong> day{daysSince === 1 ? "" : "s"} ago. We recommend backing up at least every 7 days.</>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" /> Export Database
          </CardTitle>
          <CardDescription>
            Saves the entire company state (ledgers, items, vouchers, postings, allocations, recurring
            invoices) into a single JSON file. On the desktop app it's saved under
            Documents/YourMehtaji/Exports/&lt;Company&gt;/backups/.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={doExport} disabled={exporting || disabled}>
            {exporting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting…</>
              : <><Download className="mr-2 h-4 w-4" />Export full backup (.json)</>}
          </Button>
          {lastBackup && (
            <div className="mt-2 text-xs text-muted-foreground">
              Last export: {new Date(lastBackup).toLocaleString()}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Restore from Backup
          </CardTitle>
          <CardDescription>
            Replaces ALL data in the current company with the contents of the selected backup file.
            This action cannot be undone — export a fresh backup first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setPendingFile(f); setConfirmOpen(true); }
            }}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
          />
          {summary && (
            <div className="rounded-md border bg-emerald-500/5 p-3 text-xs">
              <div className="font-medium mb-1">Restore complete:</div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Ledgers: {summary.ledgers}</Badge>
                <Badge variant="outline">Items: {summary.items}</Badge>
                <Badge variant="outline">Vouchers: {summary.vouchers}</Badge>
                <Badge variant="outline">Posting rows: {summary.voucher_entries}</Badge>
                <Badge variant="outline">Voucher items: {summary.voucher_items}</Badge>
                <Badge variant="outline">Allocations: {summary.bill_allocations}</Badge>
                <Badge variant="outline">Recurring: {summary.recurring_invoices}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(v) => { setConfirmOpen(v); if (!v) setPendingFile(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm restore</AlertDialogTitle>
            <AlertDialogDescription>
              All ledgers, items, vouchers, postings, and allocations in <strong>{companyName}</strong>{" "}
              will be deleted and replaced with the contents of <strong>{pendingFile?.name}</strong>.
              This cannot be undone. Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRestore} disabled={restoring}>
              {restoring ? "Restoring…" : "Yes, replace everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
