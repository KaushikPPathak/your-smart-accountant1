import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cloud, Upload, RefreshCw, CheckCircle2, Database } from "lucide-react";
import { toast } from "sonner";
import { getOfflineCacheCounts, pullSnapshot } from "@/lib/offline/snapshot";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { drainOutbox, queueSize } from "@/lib/offline/outbox";

export const Route = createFileRoute("/app/data-sync")({
  component: DataSyncPage,
  errorComponent: ({ error }) => (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Data Sync Error</CardTitle>
          <CardDescription>{error?.message ?? "Unexpected error"}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Page not found.</div>,
});

type Counts = Record<string, number>;
const RESTORE_TABLES = ["companies", "ledgers", "vouchers", "company_members"] as const;
const supabase: any = supabaseTyped;

function DataSyncPage() {
  const router = useRouter();
  const [cloudBusy, setCloudBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [cloudCounts, setCloudCounts] = useState<Counts>({});
  const [restoreCounts, setRestoreCounts] = useState<Counts>({});
  const [cloudDone, setCloudDone] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCloudSync() {
    setCloudBusy(true);
    setCloudDone(false);
    setCloudCounts({});
    const counts: Counts = {};
    try {
      const pushed = await drainOutbox();
      if (pushed.failed > 0 || await queueSize() > 0) {
        toast.error("Pending offline work could not be pushed, so data was not marked as matching");
        return;
      }
      const result = await pullSnapshot({ full: true });
      if (!result) {
        toast.error("Connect online once to match online and offline data");
        return;
      }
      if (Object.keys(result.errors).length > 0) {
        toast.error("Sync incomplete — offline data was not marked as matching");
        return;
      }
      Object.assign(counts, await getOfflineCacheCounts());
      setCloudCounts({ ...counts });
      setCloudDone(true);
      const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
      toast.success(`Online and offline data match (${total} local rows verified)`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleRestoreFile(file: File) {
    setRestoreBusy(true);
    setRestoreDone(false);
    setRestoreCounts({});
    const counts: Counts = {};
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        toast.error("Invalid backup: expected a JSON object");
        return;
      }
      for (const table of RESTORE_TABLES) {
        const rows = Array.isArray(parsed[table]) ? parsed[table] : [];
        if (rows.length === 0) {
          counts[table] = 0;
          setRestoreCounts({ ...counts });
          continue;
        }
        try {
            const { error } = await supabase.from(table).insert(rows as any);
          if (error) {
            toast.error(`Restore failed for ${table}: ${error.message ?? "unknown"}`);
            continue;
          }
          counts[table] = rows.length;
          setRestoreCounts({ ...counts });
          toast.success(`Restored ${rows.length} ${table}`);
        } catch (e: any) {
          toast.error(`${table}: ${e?.message ?? "error"}`);
        }
      }
      setRestoreDone(true);
      const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
      toast.success(`Backup restore complete (${total} rows written locally)`);
    } catch (e: any) {
      toast.error(`Failed to parse backup: ${e?.message ?? "invalid JSON"}`);
    } finally {
      setRestoreBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleRestoreFile(f);
  }

  function refresh() {
    router.invalidate();
    toast.success("Dashboard view refreshed");
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Database className="h-6 w-6" /> Data Synchronization & Backup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seed local offline storage from the cloud, or restore from a JSON backup file.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" /> Cloud → Local sync
          </CardTitle>
          <CardDescription>
            Exact mirror sync: pushes pending offline work first, then replaces stale local rows with current online data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleCloudSync} disabled={cloudBusy}>
            {cloudBusy ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Syncing…</>
            ) : (
              <><Cloud className="h-4 w-4 mr-2" /> Match Online and Offline Data</>
            )}
          </Button>
          <div className="flex flex-wrap gap-2">
            {Object.entries(cloudCounts).map(([t, n]) => (
              <Badge key={t} variant="default">
                {t}: {n}
              </Badge>
            ))}
            {cloudDone && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Complete
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Restore from JSON backup
          </CardTitle>
          <CardDescription>
            Upload a JSON backup containing arrays for companies, ledgers, vouchers and
            memberships. Records are written directly into local storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm">
              {restoreBusy ? "Importing…" : "Drop a .json backup here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleRestoreFile(f);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {RESTORE_TABLES.map((t) => (
              <Badge key={t} variant={restoreCounts[t] != null ? "default" : "outline"}>
                {t}: {restoreCounts[t] ?? "—"}
              </Badge>
            ))}
            {restoreDone && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Complete
              </Badge>
            )}
          </div>
          {(cloudDone || restoreDone) && (
            <Button variant="outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh Dashboard View
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
