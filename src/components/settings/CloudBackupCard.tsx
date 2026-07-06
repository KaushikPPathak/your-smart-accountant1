// User-owned cloud backup card.
//
// Manual .laccbak file (Phase 3a) + direct OAuth push to the user's own
// Google Drive / OneDrive / Dropbox account (Phase 3b). Tokens live in
// localStorage on this device only — we never see them.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Cloud, Download, Upload, HardDrive, Info, CheckCircle2, LogOut, Loader2 } from "lucide-react";
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
import { buildCompanyBackup } from "@/lib/backup";
import { wrapBackup } from "@/lib/backup-policy";
import { BackupInspectDialog } from "@/components/BackupInspectDialog";
import {
  PROVIDERS,
  connectProvider,
  disconnectProvider,
  isConnected,
  loadToken,
  uploadBackup,
  getClientId,
  type ProviderId,
} from "@/lib/cloud-providers";

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

export function CloudBackupCard() {
  const { activeCompanyId, activeMembership, memberships } = useCompany();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<null | "one" | "all" | ProviderId>(null);
  const [lastAt, setLastAt] = useState<string | null>(() => getLastUserCloudBackup());
  const [inspectOpen, setInspectOpen] = useState(false);
  const [connections, setConnections] = useState<Record<ProviderId, { connected: boolean; label?: string }>>({
    gdrive: { connected: false }, onedrive: { connected: false }, dropbox: { connected: false },
  });
  const isAdmin = activeMembership?.role === "admin";

  const refreshConnections = () => {
    setConnections({
      gdrive: { connected: isConnected("gdrive"), label: loadToken("gdrive")?.account_label },
      onedrive: { connected: isConnected("onedrive"), label: loadToken("onedrive")?.account_label },
      dropbox: { connected: isConnected("dropbox"), label: loadToken("dropbox")?.account_label },
    });
  };
  useEffect(() => { refreshConnections(); }, []);

  // ---------- Manual .laccbak ----------
  const exportOne = async () => {
    if (!activeCompanyId) return;
    setBusy("one");
    try {
      const name = activeMembership?.companies.name ?? "company";
      const res = await exportCompanyLaccbak(activeCompanyId, name);
      markUserCloudBackupNow();
      setLastAt(getLastUserCloudBackup());
      toast.success(res.desktopPath ? `Saved to ${res.desktopPath}` : `Downloaded ${res.fileName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally { setBusy(null); }
  };

  const exportAll = async () => {
    if (!memberships.length) return;
    setBusy("all");
    try {
      const list = memberships.map((m) => ({ id: m.company_id, name: m.companies.name }));
      const res = await exportAllCompaniesLaccbak(list);
      markUserCloudBackupNow();
      setLastAt(getLastUserCloudBackup());
      toast.success(res.desktopPath ? `Saved to ${res.desktopPath}` : `Downloaded ${res.fileName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally { setBusy(null); }
  };

  // Restore is handled by the BackupInspectDialog — see JSX below. The
  // dialog does automatic integrity validation before any wipe.

  // ---------- OAuth providers ----------
  const connect = async (id: ProviderId) => {
    if (!getClientId(id)) {
      toast.error(
        `${PROVIDERS[id].label} isn't configured on this build. Ask your operator to set VITE_${id.toUpperCase()}_CLIENT_ID.`,
        { duration: 8000 },
      );
      return;
    }
    setBusy(id);
    try {
      await connectProvider(id);
      refreshConnections();
      toast.success(`Connected to ${PROVIDERS[id].label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to connect to ${PROVIDERS[id].label}`);
    } finally { setBusy(null); }
  };

  const disconnect = (id: ProviderId) => {
    disconnectProvider(id);
    refreshConnections();
    toast.success(`Disconnected from ${PROVIDERS[id].label}`);
  };

  const pushToProvider = async (id: ProviderId) => {
    if (!activeCompanyId) return;
    setBusy(id);
    try {
      const name = activeMembership?.companies.name ?? "company";
      const payload = await buildCompanyBackup(activeCompanyId);
      const envelope = await wrapBackup(payload);
      const contents = JSON.stringify(envelope);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileName = `${safeName(name)}_${stamp}.${LACCBAK_EXT}`;
      const res = await uploadBackup(id, fileName, contents);
      markUserCloudBackupNow();
      setLastAt(getLastUserCloudBackup());
      toast.success(`Uploaded to ${PROVIDERS[id].label}: ${res.path}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Upload to ${PROVIDERS[id].label} failed`);
    } finally { setBusy(null); }
  };

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
            <strong> you own</strong>. Every provider below signs into
            <em> your </em> account with permission scoped to a folder this
            app creates — we never see your accounting data or your login.
          </span>
        </p>

        {/* Manual file */}
        <div className="rounded-md border p-3 space-y-3">
          <div>
            <div className="font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Manual backup file
            </div>
            <div className="text-xs text-muted-foreground">
              Portable <code>.{LACCBAK_EXT}</code> file — save anywhere.
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Last backup (any method): {formatWhen(lastAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={exportOne} disabled={busy !== null || !activeCompanyId}>
              <Download className="mr-2 h-4 w-4" />
              {busy === "one" ? "Exporting…" : `Export this company (.${LACCBAK_EXT})`}
            </Button>
            <Button size="sm" variant="outline" onClick={exportAll} disabled={busy !== null || memberships.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              {busy === "all" ? "Exporting…" : "Export all companies"}
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => setInspectOpen(true)}
              disabled={busy !== null || !isAdmin || !activeCompanyId}
              title={isAdmin ? "Inspect a backup file, then restore" : "Only admins can restore"}
            >
              <Upload className="mr-2 h-4 w-4" />
              Inspect &amp; restore .{LACCBAK_EXT}
            </Button>
            {/* Legacy hidden input retained to avoid ref-null crashes; not used now. */}
            <input
              ref={fileRef} type="file"
              accept={`.${LACCBAK_EXT},.json,application/json,application/octet-stream`}
              className="hidden"
            />
          </div>
        </div>

        {/* OAuth providers */}
        <div className="rounded-md border p-3 space-y-3">
          <div>
            <div className="font-medium">One-click cloud backup</div>
            <div className="text-xs text-muted-foreground">
              Sign in with your own account. Files go into a folder in
              <em> your </em> drive; you can revoke access at any time from
              the provider&apos;s security page.
            </div>
          </div>
          <div className="space-y-2">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
              const p = PROVIDERS[id];
              const conn = connections[id];
              const configured = !!getClientId(id);
              const isBusy = busy === id;
              return (
                <div key={id} className="flex items-center justify-between gap-3 rounded border bg-background/50 p-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {p.label}
                      {conn.connected && (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Connected
                        </Badge>
                      )}
                      {!configured && <Badge variant="outline">Not configured</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {conn.connected
                        ? conn.label ?? "Signed in"
                        : configured
                        ? "Not connected"
                        : "Operator must set the client ID for this provider"}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {conn.connected ? (
                      <>
                        <Button size="sm" onClick={() => pushToProvider(id)} disabled={busy !== null || !activeCompanyId}>
                          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          {isBusy ? "Uploading…" : "Backup now"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => disconnect(id)} disabled={busy !== null}>
                          <LogOut className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => connect(id)} disabled={busy !== null || !configured}>
                        {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isBusy ? "Connecting…" : "Connect"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            OAuth redirect URI to register with each provider:{" "}
            <code>{typeof window !== "undefined" ? `${window.location.origin}/oauth-callback` : "/oauth-callback"}</code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
