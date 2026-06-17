// Housekeeping tab: export full company backup to JSON; restore from JSON file.
import { useEffect, useRef, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Upload, Loader2, ShieldAlert, HardDriveDownload, FolderOpen, FolderCog, Folder } from "lucide-react";
import { toast } from "sonner";
import {
  exportCompanyBackup, parseBackupFile, restoreCompanyBackup,
  buildCompanyBackup, exportAllCompaniesBackup,
  type RestoreSummary,
} from "@/lib/backup";
import { useCompany } from "@/lib/company-context";
import { Layers } from "lucide-react";
import { wrapBackup } from "@/lib/backup-policy";
import {
  saveWithPickerNative, isDesktopRuntime, showInFolderNative, openPathNative,
  pickFolderNative, pickFileNative, readAbsoluteTextFileNative,
} from "@/lib/native-bridge";
import { getAppPaths } from "@/lib/app-paths";
import { BACKUP_POLICY } from "@/lib/backup-policy";
import { writeLocalMirror } from "@/lib/local-mirror";
import { getBackupFolder, setBackupFolder } from "@/lib/backup-location";

interface Props {
  companyId: string;
  companyName: string;
  partyCode?: string | null;
  disabled: boolean;
}

export function BackupRestoreTool({ companyId, companyName, partyCode, disabled }: Props) {
  const { memberships } = useCompany();
  const [exporting, setExporting] = useState(false);
  const [exportingAs, setExportingAs] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dataRoot, setDataRoot] = useState<string | null>(null);
  const [backupFolder, setBackupFolderState] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resolve the OS-standard local data folder + load the user-chosen backup folder.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let cancelled = false;
    (async () => {
      const paths = await getAppPaths();
      if (!cancelled && paths) setDataRoot(paths.root);
    })();
    setBackupFolderState(getBackupFolder(companyId));
    return () => { cancelled = true; };
  }, [companyId]);

  async function chooseBackupFolder(): Promise<string | null> {
    const r = await pickFolderNative(backupFolder ?? undefined);
    if (!r.ok || !r.path) {
      if (r.error && r.error !== "cancelled") toast.error(r.error);
      return null;
    }
    setBackupFolder(companyId, r.path);
    setBackupFolderState(r.path);
    toast.success("Backup folder set", { description: r.path });
    return r.path;
  }

  async function doExport() {
    if (!companyId) return;
    if (isDesktopRuntime() && !backupFolder) {
      const picked = await chooseBackupFolder();
      if (!picked) return;
    }
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

  async function doExportAs() {
    if (!companyId) return;
    setExportingAs(true);
    try {
      const payload = await buildCompanyBackup(companyId);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const safe = companyName.replace(/[^a-zA-Z0-9_\-. ]+/g, "_").slice(0, 80) || "Company";
      const fileName = `${safe}_backup_${stamp}.json`;
      const envelope = await wrapBackup(payload);
      const contents = JSON.stringify(envelope, null, 2);
      const r = await saveWithPickerNative(fileName, contents, [
        { name: "JSON Backup", extensions: ["json"] },
      ]);
      if (r.ok) {
        toast.success(`Backup saved to: ${r.path}`);
        try { localStorage.setItem(`lastBackup:${companyId}`, new Date().toISOString()); } catch { /* ignore */ }
      } else if (r.error === "cancelled") {
        // user cancelled — silent
      } else {
        toast.error(r.error || "Save failed");
      }
    } catch (e) {
      toast.error((e as Error).message || "Export failed");
    } finally {
      setExportingAs(false);
    }
  }

  async function doMirror() {
    if (!companyId) return;
    if (isDesktopRuntime() && !backupFolder) {
      const picked = await chooseBackupFolder();
      if (!picked) return;
    }
    setMirroring(true);
    try {
      const r = await writeLocalMirror(companyId, companyName, partyCode ?? null);
      toast.success(
        r.isDesktop ? "Local copy saved to your PC" : "JSON backup downloaded",
        { description: r.jsonFile, duration: 6000 },
      );
      try { localStorage.setItem(`lastBackup:${companyId}`, new Date().toISOString()); } catch { /* ignore */ }
    } catch (e) {
      toast.error((e as Error).message || "Local save failed");
    } finally {
      setMirroring(false);
    }
  }

  async function doRestoreFromFolder() {
    // Native file picker that opens inside the chosen backup folder.
    const startDir = backupFolder
      ? `${backupFolder.replace(/[\\/]+$/, "")}/${companyName.replace(/[^a-zA-Z0-9_\-. ]+/g, "_")}/backups`
      : undefined;
    const pick = await pickFileNative(startDir, [{ name: "JSON Backup", extensions: ["json"] }]);
    if (!pick.ok || !pick.path) {
      if (pick.error && pick.error !== "cancelled") toast.error(pick.error);
      return;
    }
    const read = await readAbsoluteTextFileNative(pick.path);
    if (!read.ok || !read.text) {
      toast.error(read.error || "Could not read file");
      return;
    }
    // Wrap as a File so the existing doRestore() pipeline can consume it.
    const fileName = pick.path.split(/[\\/]/).pop() || "backup.json";
    const file = new File([read.text], fileName, { type: "application/json" });
    setPendingFile(file);
    setConfirmOpen(true);
  }


  async function doRestore() {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      // Detect archive formats (RAR / ZIP / 7z) by magic bytes before reading as text
      const head = new Uint8Array(await pendingFile.slice(0, 8).arrayBuffer());
      const isRar =
        head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21; // "Rar!"
      const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
      const is7z =
        head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf; // "7z.."
      if (isRar || isZip || is7z) {
        const kind = isRar ? "RAR" : isZip ? "ZIP" : "7z";
        toast.error(
          `${kind} archive detected. Please extract the .json backup file from the archive first, then upload only the .json file.`,
        );
        return;
      }

      const lower = pendingFile.name.toLowerCase();
      if (!lower.endsWith(".json")) {
        toast.error(
          "Restore only accepts the .json file produced by 'Export full backup'. The selected file is not a .json file.",
        );
        return;
      }

      const text = await pendingFile.text();
      const parsed = await parseBackupFile(text);
      if (parsed.checksumOk === false) {
        toast.warning("Backup checksum mismatch — the file may be corrupted or edited. Proceeding anyway.");
      }
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

      {isDesktopRuntime() && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Folder className="h-4 w-4" /> Backup folder
            </CardTitle>
            <CardDescription>
              All backups for <strong>{companyName}</strong> are saved here. Pick a folder you can
              easily find — Documents, a USB / external drive, or a cloud-synced folder
              (OneDrive / Google Drive / Dropbox).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {backupFolder ? (
              <div className="rounded-md border bg-background p-2 text-xs">
                <div className="break-all font-mono">{backupFolder}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Backups go to <code>{backupFolder.replace(/[\\/]+$/, "")}/{companyName}/backups/</code>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-background p-2 text-xs text-muted-foreground">
                Not set yet — click <strong>Change…</strong> to choose where backups should go.
                Until you pick one, backups fall back to the app's hidden local data folder.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void chooseBackupFolder()}>
                <FolderCog className="mr-1 h-3.5 w-3.5" />
                {backupFolder ? "Change…" : "Choose folder…"}
              </Button>
              {backupFolder && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void openPathNative(backupFolder)}
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" /> Open
                </Button>
              )}
            </div>
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
            invoices) into a single JSON file. On the desktop app it's saved under your per-user
            local data folder — see the path below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={doExport} disabled={exporting || disabled}>
              {exporting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting…</>
                : <><Download className="mr-2 h-4 w-4" />Export full backup (.json)</>}
            </Button>
            {isDesktopRuntime() && (
              <Button
                variant="outline"
                onClick={doExportAs}
                disabled={exportingAs || disabled}
                title="Choose where to save the backup file (USB / external drive / any folder)"
              >
                {exportingAs
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                  : <><FolderOpen className="mr-2 h-4 w-4" />Save as… (choose folder)</>}
              </Button>
            )}
          </div>
          <div>
            <Button
              variant="outline"
              onClick={doMirror}
              disabled={mirroring || disabled}
              title="Saves both JSON (for restore) and Excel (human-readable) to your PC"
            >
              {mirroring
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                : <><HardDriveDownload className="mr-2 h-4 w-4" />Backup now (JSON + Excel)</>}
            </Button>
            <p className="mt-1 text-[11px] text-muted-foreground">
              In the desktop app, both files are written silently to your chosen
              backup folder (in subfolders <code>&lt;Company&gt;/backups/</code> and
              <code className="ml-1">&lt;Company&gt;/latest/</code>). In a browser tab, both
              files download to your Downloads folder.
            </p>
          </div>
          {dataRoot && (
            <div className="mt-3 rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <div className="flex items-start gap-2">
                <FolderCog className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">App data folder (logs, cache)</div>
                  <div className="break-all font-mono">{dataRoot}</div>
                  <div className="mt-0.5">
                    Internal app storage — lives outside <code>Program Files</code> so a Windows
                    installer upgrade never touches it. Your actual backups now go to the
                    <strong> Backup folder</strong> you picked above.
                  </div>
                  <div className="mt-1 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void openPathNative(dataRoot)}
                    >
                      <FolderOpen className="mr-1 h-3 w-3" /> Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void showInFolderNative(dataRoot)}
                    >
                      Reveal in Explorer
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
          <p className="text-xs text-muted-foreground">
            Only the <strong>.json</strong> file produced by <em>Export full backup</em> is supported.
            Archives like .rar / .zip / .7z must be extracted first.
          </p>
          {isDesktopRuntime() && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void doRestoreFromFolder()} disabled={disabled}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Choose backup file…
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {backupFolder
                  ? <>Opens in <code className="break-all">{backupFolder}</code></>
                  : <>Opens the file picker. Tip: set a <strong>Backup folder</strong> above so this opens straight there.</>}
              </span>
            </div>
          )}
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">
              …or pick a backup file from anywhere on your computer:
            </div>
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
          </div>
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

      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-base">Backup policy (industry standard)</CardTitle>
          <CardDescription>
            Rules applied to every backup this app produces. Aligned with the Income-tax Act §44AA / Rule 6F,
            CGST Act §36, Companies Act §128(5) and the ISO/NIST <strong>3-2-1</strong> backup rule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div><strong>Frequency:</strong> at least every {BACKUP_POLICY.recommendedFrequencyDays} days, and always before
            year-end closure, bulk import, restore, mass-delete or software upgrade.</div>
          <div><strong>Integrity:</strong> every file is wrapped in a signed envelope with a
            <code className="mx-1">{BACKUP_POLICY.integrity.algorithm}</code> checksum that is verified on restore.</div>
          <div><strong>Naming:</strong> <code>{BACKUP_POLICY.naming}</code> (ISO timestamp — sorts chronologically).</div>
          <div><strong>3-2-1 rule:</strong> keep <strong>{BACKUP_POLICY.copies.count}</strong> copies on
            {" "}<strong>{BACKUP_POLICY.copies.media}</strong> different media, with
            {" "}<strong>{BACKUP_POLICY.copies.offsite}</strong> stored off-site
            (cloud / external HDD in another premise).</div>
          <div><strong>Retention (GFS rotation):</strong> last {BACKUP_POLICY.retention.daily} daily,
            {" "}{BACKUP_POLICY.retention.weekly} weekly, {BACKUP_POLICY.retention.monthly} monthly,
            plus every financial-year-end <strong>kept forever</strong>.
            Minimum legal retention: <strong>{BACKUP_POLICY.retention.minimumMonths / 12} years</strong>.</div>
          <div><strong>Test restore:</strong> verify a backup on a scratch company at least every
            {" "}{BACKUP_POLICY.testRestoreFrequencyDays} days — an untested backup is not a backup.</div>
          <div className="text-muted-foreground">
            Encryption tip: when copying to USB / cloud, store inside an encrypted container
            (BitLocker / VeraCrypt) — accounting data is sensitive.
          </div>
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
