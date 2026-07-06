// User-owned cloud backup card.
//
// This is the user's control panel for backing their business data up to
// storage THEY own. It never talks to our servers — every path here writes
// to either a local file the user then uploads, or (soon) directly to the
// user's own Google Drive / OneDrive / Dropbox account.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Cloud, Download, Upload, HardDrive, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/lib/company-context";
import {
  exportCompanyLaccbak,
  exportAllCompaniesLaccbak,
  markUserCloudBackupNow,
  getLastUserCloudBackup,
  LACCBAK_EXT,
} from "@/lib/user-cloud-backup";
import { parseBackupFile, restoreCompanyBackup } from "@/lib/backup";
import { savePreRestoreSnapshot } from "@/lib/restore-safety";

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString();
}

export function CloudBackupCard() {
  const { activeCompanyId, activeMembership, memberships } = useCompany();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<null | "one" | "all" | "restore">(null);
  const [lastAt, setLastAt] = useState<string | null>(() => getLastUserCloudBackup());
  const isAdmin = activeMembership?.role === "admin";

  const exportOne = async () => {
    if (!activeCompanyId) return;
    setBusy("one");
    try {
      const name = activeMembership?.companies.name ?? "company";
      const res = await exportCompanyLaccbak(activeCompanyId, name);
      markUserCloudBackupNow();
      setLastAt(getLastUserCloudBackup());
      toast.success(
        res.desktopPath
          ? `Saved to ${res.desktopPath}`
          : `Downloaded ${res.fileName} — upload it to your own cloud drive`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  };

  const exportAll = async () => {
    if (!memberships.length) return;
    setBusy("all");
    try {
      const list = memberships.map((m) => ({ id: m.company_id, name: m.companies.name }));
      const res = await exportAllCompaniesLaccbak(list);
      markUserCloudBackupNow();
      setLastAt(getLastUserCloudBackup());
      toast.success(
        res.desktopPath ? `Saved to ${res.desktopPath}` : `Downloaded ${res.fileName}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeCompanyId) return;
    if (!isAdmin) { toast.error("Only admins can restore"); return; }
    const targetName = activeMembership?.companies.name ?? "";
    const typed = prompt(
      `RESTORE — this will REPLACE all current data in "${targetName}" with the backup file.\n\n` +
      `Type the company name exactly to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== targetName) { toast.error(`Name did not match "${targetName}" — restore cancelled.`); return; }
    setBusy("restore");
    try {
      const text = await file.text();
      const parsed = await parseBackupFile(text);
      if (parsed.checksumOk === false) toast.warning("Backup checksum mismatch — file may be corrupted or edited.");
      const single = parsed.kind === "single" ? parsed.data : parsed.data.companies[0];
      if (!single) throw new Error("Backup file is empty");
      const snap = await savePreRestoreSnapshot(activeCompanyId, targetName);
      if (!snap.ok) toast.warning("Could not create safety snapshot — proceeding without undo option.");
      const summary = await restoreCompanyBackup(activeCompanyId, single, { wipeExisting: true });
      toast.success(
        `Restored: ${summary.ledgers} ledgers, ${summary.items} items, ${summary.vouchers} vouchers`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  const providerSoon = (label: string) => () =>
    toast.info(`${label} backup — coming soon. Use “Export .${LACCBAK_EXT}” and upload the file to your ${label} for now.`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          Your own cloud backup
          <Badge variant="secondary" className="ml-2">You control the storage</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Your business data lives on this computer. Back it up to storage
            <strong> you own</strong> — a USB drive, or your personal Google
            Drive / OneDrive / Dropbox account. We never see your accounting
            data.
          </span>
        </p>

        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> Manual backup file
              </div>
              <div className="text-xs text-muted-foreground">
                Creates a portable <code>.{LACCBAK_EXT}</code> file. Save it
                anywhere — upload to your own cloud drive to keep an off-site copy.
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Last backup: {formatWhen(lastAt)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={exportOne} disabled={busy !== null || !activeCompanyId}>
              <Download className="mr-2 h-4 w-4" />
              {busy === "one" ? "Exporting…" : `Export this company (.${LACCBAK_EXT})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportAll}
              disabled={busy !== null || memberships.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              {busy === "all" ? "Exporting…" : "Export all companies"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null || !isAdmin}
              title={isAdmin ? "" : "Only admins can restore"}
            >
              <Upload className="mr-2 h-4 w-4" />
              {busy === "restore" ? "Restoring…" : `Restore from .${LACCBAK_EXT}`}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={`.${LACCBAK_EXT},.json,application/json,application/octet-stream`}
              className="hidden"
              onChange={onRestore}
            />
          </div>
        </div>

        <div className="rounded-md border p-3 space-y-3">
          <div>
            <div className="font-medium">One-click cloud backup</div>
            <div className="text-xs text-muted-foreground">
              Sign in with your own account. Backups go into a folder in
              <em> your </em> drive; you can revoke access at any time.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={providerSoon("Google Drive")} disabled={busy !== null}>
              Google Drive <Badge variant="secondary" className="ml-2">Soon</Badge>
            </Button>
            <Button size="sm" variant="outline" onClick={providerSoon("OneDrive")} disabled={busy !== null}>
              OneDrive <Badge variant="secondary" className="ml-2">Soon</Badge>
            </Button>
            <Button size="sm" variant="outline" onClick={providerSoon("Dropbox")} disabled={busy !== null}>
              Dropbox <Badge variant="secondary" className="ml-2">Soon</Badge>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
