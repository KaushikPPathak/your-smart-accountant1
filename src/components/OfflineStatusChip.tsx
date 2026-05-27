// Top-bar chip that tells the user whether the app is online, offline, or
// currently flushing a queue of pending writes. Click to inspect the outbox.

import { useEffect, useState } from "react";
import { CloudOff, Cloud, Loader2, RefreshCw, Trash2 } from "lucide-react";
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
import { toast } from "sonner";

export function OfflineStatusChip() {
  const online = useOnlineStatus();
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [draining, setDraining] = useState(false);

  useEffect(() => {
    const refresh = async () => {
      const list = await listOutbox();
      setRows(list);
      setCount(list.length);
    };
    void refresh();
    const unsub = subscribeOutbox(() => { void refresh(); });
    const t = setInterval(refresh, 5000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  const onSyncNow = async () => {
    setDraining(true);
    try {
      const res = await drainOutbox();
      if (res.pushed > 0) toast.success(`Synced ${res.pushed} change${res.pushed === 1 ? "" : "s"}`);
      else if (res.failed > 0) toast.error("Sync failed — check the queue for details");
      else toast.message("Nothing to sync");
    } finally {
      setDraining(false);
    }
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
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</span>
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
