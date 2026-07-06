import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, HelpCircle, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/lib/company-context";
import { getAllIntegrity, countLive, totalRows, type IntegrityEntry } from "@/lib/integrity";
import { runAutoRestore, getAutoRestoreEvents, type AutoRestoreOutcome } from "@/lib/auto-restore";
import { toast } from "sonner";

export const Route = createFileRoute("/app/data-health")({
  head: () => ({
    meta: [
      { title: "Data health — Smart Accountant" },
      { name: "description", content: "Automatic backup, integrity, and silent recovery status for every company on this device." },
    ],
  }),
  component: DataHealthPage,
});

interface Row {
  companyId: string;
  companyName: string;
  manifest: IntegrityEntry | null;
  live: { ledgers: number; items: number; vouchers: number };
}

function formatWhen(ms?: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

function DataHealthPage() {
  const { memberships } = useCompany();
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<AutoRestoreOutcome[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const manifest = await getAllIntegrity();
    const list: Row[] = [];
    for (const m of memberships) {
      const id = m.company_id;
      const name = m.companies?.name ?? "company";
      const live = await countLive(id);
      list.push({ companyId: id, companyName: name, manifest: manifest[id] ?? null, live });
    }
    setRows(list);
    setEvents(await getAutoRestoreEvents());
  }, [memberships]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onVerifyNow = async () => {
    setBusy(true);
    try {
      const companies = memberships.map((m) => ({ id: m.company_id, name: m.companies?.name ?? "company" }));
      const out = await runAutoRestore(companies);
      const restored = out.filter((o) => o.status === "restored");
      if (restored.length > 0) {
        toast.success(`Restored ${restored.length} compan${restored.length === 1 ? "y" : "ies"} from local safety snapshot.`);
      } else {
        toast.success("All companies verified — no recovery needed.");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" /> Data health
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The app automatically snapshots your books and silently recovers them if IndexedDB is ever
            unexpectedly empty. Nothing on this page is destructive — it is read-only diagnostics.
          </p>
        </div>
        <Button onClick={onVerifyNow} disabled={busy || memberships.length === 0} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Verify all now
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-company integrity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">Live rows</th>
                  <th className="px-4 py-2">Manifest rows</th>
                  <th className="px-4 py-2">Last snapshot</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const liveTotal = r.live.ledgers + r.live.items + r.live.vouchers;
                  const manifestTotal = r.manifest ? totalRows(r.manifest) : 0;
                  let status: { label: string; icon: JSX.Element; tone: string };
                  if (!r.manifest) status = { label: "No baseline yet", icon: <HelpCircle className="h-3.5 w-3.5" />, tone: "bg-muted text-muted-foreground" };
                  else if (manifestTotal === 0) status = { label: "Empty (never had data)", icon: <HelpCircle className="h-3.5 w-3.5" />, tone: "bg-muted text-muted-foreground" };
                  else if (liveTotal >= manifestTotal * 0.9) status = { label: "Healthy", icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
                  else if (liveTotal === 0) status = { label: "Empty — recovery pending", icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "bg-destructive/15 text-destructive" };
                  else status = { label: "Shrunk — recovery pending", icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
                  return (
                    <tr key={r.companyId} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{r.companyName}</td>
                      <td className="px-4 py-2 tabular-nums">
                        L {r.live.ledgers} · I {r.live.items} · V {r.live.vouchers}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {r.manifest ? `L ${r.manifest.ledgers} · I ${r.manifest.items} · V ${r.manifest.vouchers}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {formatWhen(r.manifest?.lastGoodAt)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className={`gap-1 border-transparent ${status.tone}`}>
                          {status.icon} {status.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No companies on this device yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent auto-restore events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automatic recoveries have run. That&apos;s good — it means your data has stayed intact.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.slice(0, 20).map((e, i) => (
                <li key={i} className="flex items-start gap-2 rounded border border-border/60 bg-muted/30 px-3 py-2">
                  {e.status === "restored" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> :
                   e.status === "failed" ? <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" /> :
                   <HelpCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.companyName} — {e.status}</div>
                    {e.restoredFrom && <div className="truncate text-xs text-muted-foreground">from {e.restoredFrom}</div>}
                    {e.error && <div className="text-xs text-destructive">{e.error}</div>}
                    {e.restoredAtIso && <div className="text-xs text-muted-foreground">{new Date(e.restoredAtIso).toLocaleString()}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/app/housekeeping" search={{ tab: "backup" } as never}>
            <HardDriveDownload className="h-4 w-4" /> Open Backup &amp; Restore
          </Link>
        </Button>
      </div>
    </div>
  );
}
