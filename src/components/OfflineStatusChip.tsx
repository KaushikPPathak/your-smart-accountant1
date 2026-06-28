// Top-bar chip that tells the user whether the app is online, offline, or
// currently flushing a queue of pending writes. Click to inspect the outbox.

import { useEffect, useState } from "react";
import { CloudOff, Cloud, Loader2, RefreshCw, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useOnlineStatus } from "@/lib/offline/online-status";
import { drainOutbox, listOutbox, subscribeOutbox, clearOutboxRow } from "@/lib/offline/outbox";
import type { OutboxRow } from "@/lib/offline/db";
import { runSyncNow } from "@/lib/offline/sync-worker";
import { getLastSnapshotResult, pullSnapshot, resetSnapshotCache, getOfflineCacheCounts, type SnapshotResult } from "@/lib/offline/snapshot";
import { toast } from "sonner";

export function OfflineStatusChip() {
  const online = useOnlineStatus();
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [draining, setDraining] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [lastSnap, setLastSnap] = useState<SnapshotResult | null>(null);
  const [cacheCounts, setCacheCounts] = useState<Record<string, number>>({});

  const refreshCounts = async () => setCacheCounts(await getOfflineCacheCounts());

  useEffect(() => {
    const refresh = async () => {
      const [list, snap, counts] = await Promise.all([listOutbox(), getLastSnapshotResult(), getOfflineCacheCounts()]);
      setRows(list);
      setCount(list.length);
      setLastSnap(snap);
      setCacheCounts(counts);
    };
    void refresh();
    const unsub = subscribeOutbox(() => { void refresh(); });
    const t = setInterval(refresh, 5000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  const onSyncNow = async () => {
    setDraining(true);
    try {
      await runSyncNow();
      const res = await drainOutbox();
      if (res.pushed > 0) toast.success(`Synced ${res.pushed} change${res.pushed === 1 ? "" : "s"}`);
      else if (res.failed > 0) toast.error("Sync failed — check the queue for details");
      else toast.message("Sync complete");
      setLastSnap(await getLastSnapshotResult());
      await refreshCounts();
    } finally {
      setDraining(false);
    }
  };

  const onPullSnapshot = async () => {
    setPulling(true);
    try {
      const r = await pullSnapshot({ full: true });
      if (!r) toast.message("Offline — try again when connected");
      else {
        await refreshCounts();
        const counts = await getOfflineCacheCounts();
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        toast.success(`Offline cache now holds ${total} record${total === 1 ? "" : "s"}`, {
          description: "All data available offline.",
        });
        setLastSnap(r);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setPulling(false);
    }
  };

  const onResetCache = async () => {
    if (!confirm("Wipe the offline cache? Next online sync will pull everything again.")) return;
    await resetSnapshotCache();
    setLastSnap(null);
    await refreshCounts();
    toast.success("Offline cache cleared");
  };

  const variant = !online ? "destructive" : count > 0 ? "secondary" : "outline";
  const label = !online ? "Offline" : count > 0 ? `Sync (${count})` : "Online";
  const Icon = !online ? CloudOff : draining ? Loader2 : Cloud;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          title={!online ? "You are offline — changes will be queued" : count > 0 ? `${count} pending change${count === 1 ? "" : "s"}` : "Connected"}
        >
          <Icon className={`h-3.5 w-3.5 ${draining ? "animate-spin" : ""}`} />
          <Badge variant={variant} className="px-1.5 py-0 text-[10px]">{label}</Badge>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Sync status</SheetTitle>
          <SheetDescription>
            {online
              ? "You are connected. Pending changes sync automatically."
              : "You are offline. New changes are saved on this device and will be pushed when the connection returns."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">{count}</span> pending change{count === 1 ? "" : "s"}
          </div>
          <Button size="sm" variant="outline" onClick={onSyncNow} disabled={!online || draining} className="gap-1.5">
            {draining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync now
          </Button>
        </div>

        <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Offline cache</span>
            <span className="text-muted-foreground">
              {lastSnap ? `Synced ${new Date(lastSnap.finishedAt).toLocaleString()}` : "Never synced"}
            </span>
          </div>
          {lastSnap && Object.keys(lastSnap.pulled).length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {Object.entries(lastSnap.pulled).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>
              ))}
            </div>
          )}
          {lastSnap && Object.keys(lastSnap.errors).length > 0 && (
            <p className="mt-2 text-destructive">
              Errors: {Object.keys(lastSnap.errors).join(", ")}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!online || pulling} onClick={onPullSnapshot} className="h-7 gap-1.5">
              {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Pull cloud data
            </Button>
            <Button size="sm" variant="ghost" onClick={onResetCache} className="h-7 gap-1.5 text-destructive">
              <Trash2 className="h-3 w-3" /> Reset cache
            </Button>
          </div>
        </div>


        <div className="mt-4 space-y-2 overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {rows.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No pending changes.
            </p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium uppercase">{r.op}{r.table ? ` · ${r.table}` : r.rpc ? ` · ${r.rpc}` : ""}</span>
                <span className="text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleTimeString() : ""}</span>
              </div>
              {r.last_error && (
                <p className="mt-1 text-destructive">Last error: {r.last_error}</p>
              )}
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Attempts: {r.attempts}</span>
                {r.id !== undefined && (
                  <Button size="sm" variant="ghost" className="h-6 gap-1 text-destructive" onClick={() => clearOutboxRow(r.id!)}>
                    <Trash2 className="h-3 w-3" /> Drop
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
