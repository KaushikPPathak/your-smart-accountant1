import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, RefreshCw, Trash2 } from "lucide-react";
import {
  clearCrashes,
  exportCrashes,
  listCrashes,
  type CrashEntry,
} from "@/lib/crash-log";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/app/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics — Your Mehtaji" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiagnosticsPage,
});

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function kindBadge(kind: CrashEntry["kind"]): string {
  switch (kind) {
    case "failure":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
    case "error":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100";
    case "unhandledrejection":
      return "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100";
  }
}

function DiagnosticsPage() {
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = useMemo(() => listCrashes(), [tick]);

  function refresh() { setTick((t) => t + 1); }

  function handleExport() {
    try {
      const blob = new Blob([exportCrashes()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Diagnostics exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }

  function handleClear() {
    if (!confirm("Clear all recorded diagnostics? This cannot be undone.")) return;
    clearCrashes();
    refresh();
    toast.success("Diagnostics cleared");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Errors and failures recorded on this device only. Nothing here is sent to any server.
          Share the exported file with support if a restore or import ever fails.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Recorded events ({entries.length})
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={entries.length === 0}>
              <Download className="mr-1 h-4 w-4" /> Export JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear} disabled={entries.length === 0}>
              <Trash2 className="mr-1 h-4 w-4" /> Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No errors recorded. The app is running clean on this device.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">When</TableHead>
                    <TableHead className="w-[130px]">Kind</TableHead>
                    <TableHead className="w-[120px]">Scope</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <Fragment key={e.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <TableCell className="text-xs">{formatTs(e.ts)}</TableCell>
                        <TableCell>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${kindBadge(e.kind)}`}>
                            {e.kind}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{e.scope}</TableCell>
                        <TableCell className="max-w-md truncate text-xs">{e.message}</TableCell>
                      </TableRow>
                      {expanded === e.id && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/30">
                            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
{JSON.stringify(e, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
