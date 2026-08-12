// AI Test Dashboard — surfaces the harness inside the app so the operator
// can run the full suite, inspect each result, and copy the report.

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, XCircle, ChevronDown, Copy, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AiTestHarness, summariseResults, type TestResult, type TestRunSummary } from "@/lib/ai/__tests__/test-harness";
// Side-effect import so window.__aiManualTest becomes available for console use.
import "@/lib/ai/__tests__/manual-test";

export default function TestDashboard() {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<TestRunSummary | null>(null);
  const [live, setLive] = useState<TestResult[]>([]);

  const runAll = useCallback(async () => {
    setRunning(true);
    setSummary(null);
    setLive([]);
    try {
      const harness = new AiTestHarness();
      const result = await harness.runAll((r) => setLive((prev) => [...prev, r]));
      setSummary(result);
      if (result.failed === 0) toast.success(`All ${result.total} AI tests passed in ${result.totalMs}ms`);
      else toast.error(`${result.failed}/${result.total} AI tests failed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test run crashed");
    } finally {
      setRunning(false);
    }
  }, []);

  const copyReport = useCallback(async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summariseResults(summary));
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Clipboard copy blocked by the browser");
    }
  }, [summary]);

  const rows = summary?.results ?? live;
  const stats = useMemo(() => {
    if (summary) return { total: summary.total, passed: summary.passed, failed: summary.failed, rate: summary.passRate, ms: summary.totalMs };
    const passed = live.filter((r) => r.passed).length;
    return { total: live.length, passed, failed: live.length - passed, rate: live.length ? Math.round((passed / live.length) * 100) : 0, ms: 0 };
  }, [summary, live]);

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg">AI Layer Test Dashboard</CardTitle>
            <p className="text-sm text-muted-foreground">Non-destructive checks against router, retrievers, redactor, cache and semantic index.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runAll} disabled={running} aria-label="Run all AI tests">
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              {running ? "Running…" : "Run all tests"}
            </Button>
            <Button variant="outline" onClick={copyReport} disabled={!summary}>
              <Copy className="mr-2 h-4 w-4" /> Copy results
            </Button>
            <Button variant="ghost" size="icon" onClick={() => { setSummary(null); setLive([]); }} aria-label="Reset dashboard">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatBox label="Total" value={String(stats.total)} />
            <StatBox label="Passed" value={String(stats.passed)} tone="pass" />
            <StatBox label="Failed" value={String(stats.failed)} tone={stats.failed > 0 ? "fail" : "muted"} />
            <StatBox label="Pass rate" value={`${stats.rate}%`} tone={stats.rate === 100 ? "pass" : stats.rate >= 70 ? "muted" : "fail"} />
            <StatBox label="Total time" value={stats.ms ? `${stats.ms} ms` : "—"} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && !running && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Click <strong>Run all tests</strong> to start. Results appear here as they complete.</CardContent></Card>
        )}
        {rows.map((r) => (
          <ResultRow key={`${r.name}-${r.durationMs}`} result={r} />
        ))}
        {running && rows.length < 10 && (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running remaining tests…
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone = "muted" }: { label: string; value: string; tone?: "pass" | "fail" | "muted" }) {
  const toneClass =
    tone === "pass" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "fail" ? "text-red-600 dark:text-red-400"
    : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function ResultRow({ result }: { result: TestResult }) {
  const [open, setOpen] = useState(false);
  const Icon = result.passed ? CheckCircle2 : XCircle;
  const iconClass = result.passed ? "text-emerald-500" : "text-red-500";
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
            aria-expanded={open}
          >
            <Icon className={`h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{result.name}</span>
                <Badge variant={result.passed ? "secondary" : "destructive"}>{result.passed ? "PASS" : "FAIL"}</Badge>
                <Badge variant="outline">{result.durationMs} ms</Badge>
              </div>
              <div className="truncate text-sm text-muted-foreground">{result.message}</div>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/30 px-4 py-3 text-xs">
            {result.error && (
              <div className="mb-2 rounded border border-red-300 bg-red-50 p-2 font-mono text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                {result.error}
              </div>
            )}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono">
{JSON.stringify(result.details ?? {}, null, 2)}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
