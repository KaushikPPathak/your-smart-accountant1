import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cloud, Upload, RefreshCw, CheckCircle2, Database, AlertTriangle, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { getOfflineCacheCounts, pullSnapshot, type SnapshotResult } from "@/lib/offline/snapshot";
import { getStorageQuota, requestPersistentStorage, formatBytes, type StorageQuota } from "@/lib/offline/storage-quota";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import {
  drainOutbox,
  queueSize,
  listDeadLetter,
  retryDeadLetter,
  discardDeadLetter,
  subscribeOutbox,
  type DeadLetterRow,
} from "@/lib/offline/outbox";


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
  const [verificationProblems, setVerificationProblems] = useState<string[]>([]);
  const [restoreCounts, setRestoreCounts] = useState<Counts>({});
  const [cloudDone, setCloudDone] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deadLetter, setDeadLetter] = useState<DeadLetterRow[]>([]);
  const [quota, setQuota] = useState<StorageQuota | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const rows = await listDeadLetter();
      if (alive) setDeadLetter(rows);
    };
    void refresh();
    const unsub = subscribeOutbox(() => { void refresh(); });
    return () => { alive = false; unsub(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const q = await getStorageQuota();
      if (alive) setQuota(q);
    };
    void refresh();
    const id = setInterval(refresh, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  async function handlePersist() {
    const ok = await requestPersistentStorage();
    setQuota(await getStorageQuota());
    if (ok) toast.success("Offline data marked as persistent");
    else toast.warning("Browser declined — data may still be evicted if disk gets low");
  }

  async function onRetryDead(id: number) {
    await retryDeadLetter(id);
    toast.success("Queued for retry — will push on next sync");
  }
  async function onDiscardDead(id: number) {
    await discardDeadLetter(id);
    toast.success("Discarded");
  }


  async function handleCloudSync() {
    setCloudBusy(true);
    setCloudDone(false);
    setCloudCounts({});
    setVerificationProblems([]);
    const counts: Counts = {};
    try {
      const pushed = await drainOutbox();
      if (pushed.failed > 0 || await queueSize() > 0) {
        toast.error("Pending offline work could not be pushed, so data was not marked as matching");
        return;
      }
      const result = await pullSnapshot({ full: true, forceExact: true }) as SnapshotResult | null;
      if (!result) {
        toast.error("Connect online once to match online and offline data");
        return;
      }
      if (Object.keys(result.errors).length > 0) {
        setVerificationProblems(Object.values(result.errors));
        toast.error("Sync failed — existing offline data preserved");
        return;
      }
      if (result.verification && !result.verification.ok) {
        setVerificationProblems(result.verification.problems);
        toast.error("Online and offline data do not match — existing offline data preserved");
        return;
      }
      if (result.verification) {
        for (const [table, detail] of Object.entries(result.verification.tables)) counts[table] = detail.localCount;
      } else {
        Object.assign(counts, await getOfflineCacheCounts());
      }
      setCloudCounts({ ...counts });
      setCloudDone(true);
      const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
      toast.success(`All data available in offline mode (${total} rows verified)`);
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

      {deadLetter.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              {deadLetter.length} change{deadLetter.length === 1 ? "" : "s"} need your attention
            </CardTitle>
            <CardDescription>
              These local edits could not be saved to the cloud (the server rejected them or
              they failed too many times). Your other work is unaffected. Review and retry or discard each one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {deadLetter.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {row.label || `${row.op.toUpperCase()} ${row.table || row.rpc || row.executor || "unknown"}`}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {row.last_error || "Unknown error"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(row.moved_at).toLocaleString()} · {row.attempts ?? 0} attempt(s)
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => onRetryDead(row.id as number)}>
                    Retry
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDiscardDead(row.id as number)}>
                    Discard
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {quota?.supported && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" /> Offline storage
            </CardTitle>
            <CardDescription>
              How much of the browser's available storage the offline cache is using on this device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="text-sm">
                <span className="font-medium">{formatBytes(quota.usageBytes)}</span>
                <span className="text-muted-foreground"> of {formatBytes(quota.quotaBytes)} available</span>
              </div>
              <Badge variant={quota.percentUsed > 80 ? "destructive" : "secondary"}>
                {quota.percentUsed.toFixed(1)}% used
              </Badge>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${quota.percentUsed > 80 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${Math.min(100, Math.max(1, quota.percentUsed))}%` }}
              />
            </div>
            {quota.percentUsed > 80 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                Storage is filling up. If it hits the limit, new offline writes may fail. Consider
                signing out of unused companies or clearing browser data for other sites on this device.
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-xs text-muted-foreground">
                {quota.persisted
                  ? "Persistent storage granted — browser will not evict this data under disk pressure."
                  : "Persistent storage NOT granted — browser may clear this data if the device runs low on space."}
              </div>
              {!quota.persisted && (
                <Button size="sm" variant="outline" onClick={handlePersist}>
                  Request persistence
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}




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
          {verificationProblems.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Verification failed — existing offline data was preserved.</p>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {verificationProblems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
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
