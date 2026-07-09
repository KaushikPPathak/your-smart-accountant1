// Field-integrity audit UI. Read-only, batched, non-blocking. See
// src/lib/offline/integrity-scan.ts for the scanner itself.

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, HardDriveDownload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { checkCanRebuild, rebuildCompanyCache } from "@/lib/offline/cache-rebuild";
import { getStoredSchemaVersion, SCHEMA_VERSION } from "@/lib/offline/schema-version";
import { runIntegrityScan, totalIssues, type IntegrityIssue, type ScanProgress } from "@/lib/offline/integrity-scan";

export function FieldIntegrityPanel({ companyId }: { companyId: string | null | undefined }) {
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [storedVersion, setStoredVersion] = useState<number>(SCHEMA_VERSION);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) { setIssues([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setProgress(null);
    try {
      const v = await getStoredSchemaVersion();
      setStoredVersion(v);
      const rows = await runIntegrityScan(companyId, {
        signal: ctrl.signal,
        onProgress: (p) => setProgress(p),
      });
      if (!ctrl.signal.aborted) setIssues(rows);
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(e instanceof Error ? e.message : "Audit failed");
    } finally {
      if (abortRef.current === ctrl) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [companyId]);

  // Run once on mount / company change. No timers, no background polling.
  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const onRebuild = async () => {
    if (!companyId) return;
    const guard = await checkCanRebuild(companyId);
    if (!guard.ok) { toast.error(guard.reason); return; }
    if (!confirm("Rebuild this company's local cache from the server? Unsynced changes stay in the outbox; only cached read data is refreshed.")) return;
    setRebuilding(true);
    try {
      const res = await rebuildCompanyCache(companyId);
      toast.success(`Rebuilt cache: cleared ${res.cleared} row(s), refetched ${res.fetchedTables} table(s).`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rebuild failed");
    } finally { setRebuilding(false); }
  };

  const total = issues ? totalIssues(issues) : 0;
  const schemaStale = storedVersion < SCHEMA_VERSION;
  const pct = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            {total === 0 && !schemaStale && issues ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            Field integrity
            {schemaStale && (
              <Badge variant="outline" className="ml-2">
                Schema v{storedVersion} &lt; v{SCHEMA_VERSION} — rebuild recommended
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy || !companyId}>
              <RefreshCw className={`h-4 w-4 mr-1 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Scanning…" : "Run audit"}
            </Button>
            <Button variant="outline" size="sm" onClick={onRebuild} disabled={rebuilding || !companyId}>
              <HardDriveDownload className={`h-4 w-4 mr-1 ${rebuilding ? "animate-pulse" : ""}`} />
              Rebuild from server
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {busy && progress && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{progress.phase}</span>
              <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
            </div>
            <Progress value={pct} />
          </div>
        )}
        {!companyId ? (
          <p className="text-sm text-muted-foreground">Pick a company to run the audit.</p>
        ) : issues && issues.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Table</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-[80px] text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((i, idx) => (
                <TableRow key={idx} className={i.count === 0 ? "text-muted-foreground" : ""}>
                  <TableCell>{i.table}</TableCell>
                  <TableCell>{i.issue}</TableCell>
                  <TableCell className="text-right font-mono">{i.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : !busy ? (
          <p className="text-sm text-muted-foreground">Click "Run audit" to scan.</p>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Scans run in batches of 800 rows and yield to the UI between batches. Nothing is modified — this is a read-only diagnostic.
        </p>
      </CardContent>
    </Card>
  );
}
