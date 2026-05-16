/**
 * SelfTestPanel
 *
 * One-click environment + integration smoke test. This is read-only — it
 * does NOT mutate any data. It tells the user (and support) whether the
 * app is wired up correctly on this PC / browser for the active company.
 *
 * Distinct from VerifyAndRepairTool (which checks data integrity):
 *   - VerifyAndRepair  → "are my books consistent?"
 *   - SelfTest         → "is the app itself healthy on this machine?"
 */
import { useCallback, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Status = "pending" | "running" | "ok" | "warn" | "error";

interface Check {
  key: string;
  label: string;
  status: Status;
  message: string;
  /** Optional measured latency in ms. */
  ms?: number;
}

const INITIAL: Omit<Check, "status" | "message">[] = [
  { key: "auth", label: "Authenticated session" },
  { key: "company", label: "Active company selected" },
  { key: "db_ping", label: "Database connectivity" },
  { key: "tables", label: "Core tables readable" },
  { key: "settings", label: "Company settings row present" },
  { key: "ledgers", label: "Has at least one ledger" },
  { key: "cash_bank", label: "Cash / Bank ledger configured" },
  { key: "storage", label: "Logo storage bucket reachable" },
  { key: "browser", label: "Browser features (storage, file, print)" },
  { key: "export_libs", label: "PDF / XLSX export libraries load" },
  { key: "backup_age", label: "Recent backup on this PC" },
];

function blank(): Check[] {
  return INITIAL.map((c) => ({ ...c, status: "pending", message: "—" }));
}

async function timed<T>(p: PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await p;
  return { value, ms: Math.round(performance.now() - t0) };
}

export function SelfTestPanel({ companyId }: { companyId: string | null }) {
  const [checks, setChecks] = useState<Check[]>(() => blank());
  const [running, setRunning] = useState(false);
  const [finishedAt, setFinishedAt] = useState<Date | null>(null);

  const patch = useCallback(
    (key: string, p: Partial<Check>) =>
      setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...p } : c))),
    [],
  );

  async function run() {
    setRunning(true);
    setChecks(blank());
    setFinishedAt(null);

    const mark = async (
      key: string,
      fn: () => Promise<Pick<Check, "status" | "message"> & { ms?: number }>,
    ) => {
      patch(key, { status: "running", message: "Running…" });
      try {
        const out = await fn();
        patch(key, out);
      } catch (e) {
        patch(key, { status: "error", message: (e as Error).message || "Failed" });
      }
    };

    // 1. Auth
    await mark("auth", async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) return { status: "error", message: error.message };
      if (!data.session) return { status: "error", message: "No active session" };
      return {
        status: "ok",
        message: `Signed in as ${data.session.user.email ?? data.session.user.id.slice(0, 8)}`,
      };
    });

    // 2. Company
    await mark("company", async () =>
      companyId
        ? { status: "ok", message: `Company id ${companyId.slice(0, 8)}…` }
        : { status: "error", message: "No company selected" },
    );

    // 3. DB ping (lightweight head request on a small table)
    await mark("db_ping", async () => {
      const { ms, value } = await timed(
        supabase.from("companies").select("id", { count: "exact", head: true }),
      );
      if (value.error) return { status: "error", message: value.error.message, ms };
      const level = ms < 400 ? "ok" : ms < 1500 ? "warn" : "error";
      return {
        status: level,
        message: `Round-trip ${ms} ms${level === "warn" ? " (slow)" : level === "error" ? " (very slow)" : ""}`,
        ms,
      };
    });

    if (!companyId) {
      ["tables", "settings", "ledgers", "cash_bank", "storage"].forEach((k) =>
        patch(k, { status: "warn", message: "Skipped — no company selected" }),
      );
    } else {
      // 4. Tables readable
      await mark("tables", async () => {
        const tables = [
          "ledgers",
          "items",
          "vouchers",
          "voucher_entries",
          "voucher_items",
        ] as const;
        const results = await Promise.all(
          tables.map((t) =>
            supabase
              .from(t)
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId),
          ),
        );
        const failed = results
          .map((r, i) => (r.error ? tables[i] : null))
          .filter(Boolean) as string[];
        if (failed.length)
          return { status: "error", message: `Cannot read: ${failed.join(", ")}` };
        return { status: "ok", message: `All ${tables.length} core tables readable` };
      });

      // 5. Settings row
      await mark("settings", async () => {
        const { data, error } = await supabase
          .from("company_settings")
          .select("company_id")
          .eq("company_id", companyId)
          .maybeSingle();
        if (error) return { status: "error", message: error.message };
        return data
          ? { status: "ok", message: "Settings row present" }
          : { status: "warn", message: "Settings row missing — open Settings once" };
      });

      // 6. Ledgers
      await mark("ledgers", async () => {
        const { count, error } = await supabase
          .from("ledgers")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        if (error) return { status: "error", message: error.message };
        if (!count || count === 0)
          return { status: "warn", message: "No ledgers yet — create one or import opening balances" };
        return { status: "ok", message: `${count} ledger${count === 1 ? "" : "s"}` };
      });

      // 7. Cash / bank ledger
      await mark("cash_bank", async () => {
        const { count, error } = await supabase
          .from("ledgers")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .in("type", ["cash", "bank"]);
        if (error) return { status: "error", message: error.message };
        if (!count || count === 0)
          return { status: "warn", message: "No Cash/Bank ledger — receipts & payments need one" };
        return { status: "ok", message: `${count} cash / bank ledger${count === 1 ? "" : "s"}` };
      });

      // 8. Storage bucket
      await mark("storage", async () => {
        const { data, error } = await supabase.storage
          .from("company-logos")
          .list(companyId, { limit: 1 });
        if (error) return { status: "warn", message: error.message };
        return {
          status: "ok",
          message: `Bucket reachable (${data?.length ?? 0} object${data?.length === 1 ? "" : "s"} for this company)`,
        };
      });
    }

    // 9. Browser features
    await mark("browser", async () => {
      const missing: string[] = [];
      try {
        const k = "__selftest__";
        localStorage.setItem(k, "1");
        localStorage.removeItem(k);
      } catch {
        missing.push("localStorage");
      }
      if (typeof indexedDB === "undefined") missing.push("IndexedDB");
      if (typeof File === "undefined" || typeof Blob === "undefined")
        missing.push("File/Blob");
      if (typeof window.print !== "function") missing.push("print()");
      if (missing.length)
        return { status: "warn", message: `Missing: ${missing.join(", ")}` };
      return { status: "ok", message: "localStorage, IndexedDB, File, print()" };
    });

    // 10. Export libs (dynamic import — proves the bundles can load)
    await mark("export_libs", async () => {
      const [pdf, xlsx] = await Promise.allSettled([
        import("jspdf"),
        import("xlsx"),
      ]);
      const broken: string[] = [];
      if (pdf.status === "rejected") broken.push("jsPDF");
      if (xlsx.status === "rejected") broken.push("XLSX");
      if (broken.length)
        return { status: "error", message: `Failed to load: ${broken.join(", ")}` };
      return { status: "ok", message: "jsPDF + XLSX loaded" };
    });

    // 11. Backup freshness
    await mark("backup_age", async () => {
      if (!companyId)
        return { status: "warn", message: "Skipped — no company selected" };
      let last: string | null = null;
      try {
        last = localStorage.getItem(`lastBackup:${companyId}`);
      } catch {
        return { status: "warn", message: "Cannot read localStorage" };
      }
      if (!last) return { status: "warn", message: "No backup recorded — export one now" };
      const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
      if (days >= 14) return { status: "error", message: `Last backup ${days} days ago — overdue` };
      if (days >= 7) return { status: "warn", message: `Last backup ${days} days ago — due soon` };
      return { status: "ok", message: `Last backup ${days} day${days === 1 ? "" : "s"} ago` };
    });

    setRunning(false);
    setFinishedAt(new Date());
  }

  function copyReport() {
    const lines = [
      `Self-test report — ${new Date().toLocaleString()}`,
      `Company: ${companyId ?? "(none)"}`,
      `User-Agent: ${navigator.userAgent}`,
      "",
      ...checks.map(
        (c) => `[${c.status.toUpperCase().padEnd(5)}] ${c.label}: ${c.message}`,
      ),
    ];
    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => toast.success("Report copied to clipboard"))
      .catch(() => toast.error("Copy failed"));
  }

  const counts = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<Status, number>,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> Self-test
        </CardTitle>
        <CardDescription>
          Read-only health check of the app on this PC / browser for the active company.
          Nothing is changed — safe to run any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={run} disabled={running} size="sm">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Activity className="mr-2 h-4 w-4" />
                Run self-test
              </>
            )}
          </Button>
          <Button
            onClick={copyReport}
            variant="outline"
            size="sm"
            disabled={!finishedAt}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy report
          </Button>
          {finishedAt && (
            <span className="text-xs text-muted-foreground">
              Completed at {finishedAt.toLocaleTimeString()} ·{" "}
              <span className="text-emerald-600">{counts.ok ?? 0} ok</span>
              {" · "}
              <span className="text-amber-600">{counts.warn ?? 0} warn</span>
              {" · "}
              <span className="text-destructive">{counts.error ?? 0} error</span>
            </span>
          )}
        </div>

        <div className="divide-y rounded-md border text-sm">
          {checks.map((c) => (
            <div key={c.key} className="flex items-start gap-3 px-3 py-2">
              <span className="mt-0.5 shrink-0">
                {c.status === "ok" && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                )}
                {c.status === "warn" && (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                {c.status === "error" && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {c.status === "running" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {c.status === "pending" && (
                  <span className="block h-4 w-4 rounded-full border border-muted-foreground/40" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-muted-foreground break-words">
                  {c.message}
                </div>
              </div>
              {typeof c.ms === "number" && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {c.ms} ms
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
