/**
 * VerifyAndRepairTool
 *
 * One-click integrity check + auto-repair for the active company's books.
 *
 * Each step runs in isolation (its own try/catch) so a single failure does
 * not abort the whole pass. The UI streams a step-by-step status feed so
 * the user can see exactly what was checked, what was found, and what was
 * fixed. Destructive repairs (deleting orphans) are gated behind an admin
 * confirmation toggle; non-destructive repairs (recomputing sequences and
 * snapshots) run automatically.
 *
 * Steps:
 *   1. Unbalanced vouchers         (report; no auto-fix — needs human review)
 *   2. Orphan voucher_entries      (auto-delete if Repair enabled)
 *   3. Orphan voucher_items        (auto-delete if Repair enabled)
 *   4. Duplicate voucher numbers   (report; renumber via Renumber tab)
 *   5. Invalid posting rows        (both Dr & Cr zero, or both positive)
 *   6. Cross-company ledger refs   (entries pointing at a ledger from another co.)
 *   7. Recompute voucher number sequences  (auto)
 *   8. Rebuild monthly_balances snapshot   (auto)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/error-message";
import { runSemanticChecks } from "@/lib/semantic-checks";
import { toast } from "sonner";

type StepStatus = "pending" | "running" | "ok" | "warn" | "error";

interface StepResult {
  key: string;
  label: string;
  status: StepStatus;
  message: string;
  /** Number of issues found. 0 = clean. */
  found?: number;
  /** Number of issues auto-fixed. */
  fixed?: number;
}

const INITIAL_STEPS: Omit<StepResult, "status" | "message">[] = [
  { key: "balance",      label: "Voucher debit = credit balance check" },
  { key: "orphan_entry", label: "Orphan posting rows (no parent voucher)" },
  { key: "orphan_item",  label: "Orphan inventory rows (no parent voucher)" },
  { key: "dup_number",   label: "Duplicate voucher numbers within type" },
  { key: "bad_amount",   label: "Invalid posting amounts (both Dr & Cr zero / both > 0)" },
  { key: "xco_ledger",   label: "Cross-company ledger references" },
  { key: "seq_repair",   label: "Recompute next-voucher-number sequences" },
  { key: "snapshot",     label: "Rebuild monthly balance snapshot" },
  { key: "semantic",     label: "Report-level sanity checks (TB tally, BS tally, blank-P&L, partial restore)" },
];

function blankSteps(): StepResult[] {
  return INITIAL_STEPS.map((s) => ({ ...s, status: "pending", message: "—" }));
}

export function VerifyAndRepairTool({
  companyId,
  isAdmin,
}: {
  companyId: string | null;
  isAdmin: boolean;
}) {
  const [steps, setSteps] = useState<StepResult[]>(() => blankSteps());
  const [running, setRunning] = useState(false);
  const [autoRepair, setAutoRepair] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);

  function patch(key: string, p: Partial<StepResult>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));
  }

  async function run() {
    if (!companyId) {
      toast.error("Select a company first");
      return;
    }
    setRunning(true);
    setSummary(null);
    setSteps(blankSteps());

    let totalFound = 0;
    let totalFixed = 0;
    let hadError = false;

    // --- shared fetch (used by several steps) ----------------------------
    let vchs: { id: string; voucher_number: string; voucher_type: string }[] = [];
    let entries: { id: string; voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number }[] = [];
    let items: { id: string; voucher_id: string }[] = [];
    let ledgerIds = new Set<string>();

    try {
      const [vRes, eRes, iRes, lRes] = await Promise.all([
        supabase.from("vouchers")
          .select("id, voucher_number, voucher_type")
          .eq("company_id", companyId),
        supabase.from("voucher_entries")
          .select("id, voucher_id, ledger_id, debit_paise, credit_paise, vouchers!inner(company_id)")
          .eq("vouchers.company_id", companyId),
        supabase.from("voucher_items")
          .select("id, voucher_id, vouchers!inner(company_id)")
          .eq("vouchers.company_id", companyId),
        supabase.from("ledgers").select("id").eq("company_id", companyId),
      ]);
      if (vRes.error) throw vRes.error;
      if (eRes.error) throw eRes.error;
      if (iRes.error) throw iRes.error;
      if (lRes.error) throw lRes.error;
      vchs = (vRes.data ?? []) as typeof vchs;
      entries = (eRes.data ?? []) as unknown as typeof entries;
      items = (iRes.data ?? []) as unknown as typeof items;
      ledgerIds = new Set(((lRes.data ?? []) as { id: string }[]).map((l) => l.id));
    } catch (err) {
      // If the shared fetch fails, mark every step as error and stop.
      const msg = describeError(err);
      INITIAL_STEPS.forEach((s) => patch(s.key, { status: "error", message: msg }));
      setRunning(false);
      setSummary("Could not load company data — check your connection and try again.");
      toast.error("Verification aborted: " + msg);
      return;
    }

    const voucherIds = new Set(vchs.map((v) => v.id));

    // ------ Step 1: balance check ----------------------------------------
    patch("balance", { status: "running", message: "Scanning…" });
    try {
      const totals = new Map<string, { dr: number; cr: number }>();
      for (const e of entries) {
        const cur = totals.get(e.voucher_id) || { dr: 0, cr: 0 };
        cur.dr += e.debit_paise;
        cur.cr += e.credit_paise;
        totals.set(e.voucher_id, cur);
      }
      let unbalanced = 0;
      for (const v of vchs) {
        const t = totals.get(v.id) || { dr: 0, cr: 0 };
        if (t.dr !== t.cr) unbalanced++;
      }
      totalFound += unbalanced;
      patch("balance", {
        status: unbalanced === 0 ? "ok" : "warn",
        found: unbalanced,
        message: unbalanced === 0
          ? `All ${vchs.length} vouchers balanced ✓`
          : `${unbalanced} voucher(s) have Dr ≠ Cr — open the Verify Books tab to inspect and edit.`,
      });
    } catch (err) {
      hadError = true;
      patch("balance", { status: "error", message: describeError(err) });
    }

    // ------ Step 2: orphan voucher_entries -------------------------------
    patch("orphan_entry", { status: "running", message: "Scanning…" });
    try {
      const orphans = entries.filter((e) => !voucherIds.has(e.voucher_id));
      let fixed = 0;
      if (orphans.length > 0 && autoRepair && isAdmin) {
        const ids = orphans.map((o) => o.id);
        const { error } = await supabase.from("voucher_entries").delete().in("id", ids);
        if (error) throw error;
        fixed = orphans.length;
        totalFixed += fixed;
      }
      totalFound += orphans.length;
      patch("orphan_entry", {
        status: orphans.length === 0 ? "ok" : (fixed === orphans.length ? "ok" : "warn"),
        found: orphans.length,
        fixed,
        message: orphans.length === 0
          ? "No orphan posting rows ✓"
          : fixed > 0
            ? `Found ${orphans.length} orphan row(s) — deleted ${fixed}.`
            : `Found ${orphans.length} orphan row(s) — enable Auto-repair to delete (admin only).`,
      });
    } catch (err) {
      hadError = true;
      patch("orphan_entry", { status: "error", message: describeError(err) });
    }

    // ------ Step 3: orphan voucher_items ---------------------------------
    patch("orphan_item", { status: "running", message: "Scanning…" });
    try {
      const orphans = items.filter((it) => !voucherIds.has(it.voucher_id));
      let fixed = 0;
      if (orphans.length > 0 && autoRepair && isAdmin) {
        const ids = orphans.map((o) => o.id);
        const { error } = await supabase.from("voucher_items").delete().in("id", ids);
        if (error) throw error;
        fixed = orphans.length;
        totalFixed += fixed;
      }
      totalFound += orphans.length;
      patch("orphan_item", {
        status: orphans.length === 0 ? "ok" : (fixed === orphans.length ? "ok" : "warn"),
        found: orphans.length,
        fixed,
        message: orphans.length === 0
          ? "No orphan inventory rows ✓"
          : fixed > 0
            ? `Found ${orphans.length} orphan inventory row(s) — deleted ${fixed}.`
            : `Found ${orphans.length} orphan inventory row(s) — enable Auto-repair to delete (admin only).`,
      });
    } catch (err) {
      hadError = true;
      patch("orphan_item", { status: "error", message: describeError(err) });
    }

    // ------ Step 4: duplicate voucher numbers ----------------------------
    patch("dup_number", { status: "running", message: "Scanning…" });
    try {
      const seen = new Map<string, number>();
      for (const v of vchs) {
        const k = `${v.voucher_type}::${v.voucher_number}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const dups = [...seen.entries()].filter(([, n]) => n > 1);
      const dupRowCount = dups.reduce((sum, [, n]) => sum + (n - 1), 0);
      totalFound += dupRowCount;
      patch("dup_number", {
        status: dups.length === 0 ? "ok" : "warn",
        found: dupRowCount,
        message: dups.length === 0
          ? "No duplicate voucher numbers ✓"
          : `${dups.length} voucher-number conflict(s) (${dupRowCount} extra row(s)) — use Renumber tab to fix.`,
      });
    } catch (err) {
      hadError = true;
      patch("dup_number", { status: "error", message: describeError(err) });
    }

    // ------ Step 5: invalid posting amounts ------------------------------
    patch("bad_amount", { status: "running", message: "Scanning…" });
    try {
      let bad = 0;
      for (const e of entries) {
        const dr = e.debit_paise, cr = e.credit_paise;
        if ((dr === 0 && cr === 0) || (dr > 0 && cr > 0) || dr < 0 || cr < 0) bad++;
      }
      totalFound += bad;
      patch("bad_amount", {
        status: bad === 0 ? "ok" : "warn",
        found: bad,
        message: bad === 0
          ? "All posting amounts are valid ✓"
          : `${bad} posting row(s) have invalid amounts — open the affected voucher to correct.`,
      });
    } catch (err) {
      hadError = true;
      patch("bad_amount", { status: "error", message: describeError(err) });
    }

    // ------ Step 6: cross-company ledger refs ----------------------------
    patch("xco_ledger", { status: "running", message: "Scanning…" });
    try {
      const xco = entries.filter((e) => !ledgerIds.has(e.ledger_id));
      totalFound += xco.length;
      patch("xco_ledger", {
        status: xco.length === 0 ? "ok" : "error",
        found: xco.length,
        message: xco.length === 0
          ? "All postings reference valid ledgers ✓"
          : `${xco.length} posting(s) point at a ledger that does not belong to this company — contact support.`,
      });
    } catch (err) {
      hadError = true;
      patch("xco_ledger", { status: "error", message: describeError(err) });
    }

    // ------ Step 7: recompute voucher_number_seq -------------------------
    patch("seq_repair", { status: "running", message: "Recomputing…" });
    try {
      const maxByType = new Map<string, number>();
      for (const v of vchs) {
        const m = v.voucher_number.match(/(\d+)\s*$/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        const cur = maxByType.get(v.voucher_type) || 0;
        if (n > cur) maxByType.set(v.voucher_type, n);
      }
      let updated = 0;
      for (const [vtype, maxNum] of maxByType.entries()) {
        const { error } = await supabase
          .from("voucher_number_seq")
          .upsert(
            { company_id: companyId, voucher_type: vtype as never, prefix: "", next_number: maxNum + 1 },
            { onConflict: "company_id,voucher_type" },
          );
        if (error) throw error;
        updated++;
      }
      totalFixed += updated;
      patch("seq_repair", {
        status: "ok",
        fixed: updated,
        message: updated === 0
          ? "No sequences needed updating ✓"
          : `Reset next-number for ${updated} voucher type(s).`,
      });
    } catch (err) {
      hadError = true;
      patch("seq_repair", { status: "error", message: describeError(err) });
    }

    // ------ Step 8: rebuild monthly_balances ------------------------------
    patch("snapshot", { status: "running", message: "Rebuilding…" });
    try {
      const { data, error } = await supabase.rpc("recompute_monthly_balances", {
        _company_id: companyId,
      });
      if (error) throw error;
      patch("snapshot", {
        status: "ok",
        message: `Snapshot rebuilt — ${data ?? 0} row(s) indexed.`,
      });
    } catch (err) {
      hadError = true;
      patch("snapshot", { status: "error", message: describeError(err) });
    }

    // ------ Step 9: semantic / report-level checks -----------------------
    patch("semantic", { status: "running", message: "Auditing reports…" });
    try {
      const report = await runSemanticChecks(companyId);
      const problems = report.findings.filter((f) => f.severity !== "ok");
      totalFound += problems.length;
      const status: StepStatus = report.hasError ? "error" : report.hasWarning ? "warn" : "ok";
      const msg = problems.length === 0
        ? report.summary
        : problems.map((p) => `• ${p.message}`).join("\n");
      patch("semantic", { status, found: problems.length, message: msg });
    } catch (err) {
      hadError = true;
      patch("semantic", { status: "error", message: describeError(err) });
    }

    setRunning(false);
    if (hadError) {
      setSummary(`Completed with errors. Found ${totalFound} issue(s); fixed ${totalFixed}. See per-step messages.`);
      toast.error("Verify & Repair finished with errors");
    } else if (totalFound === 0) {
      setSummary("Books are clean. No issues found.");
      toast.success("Books verified — all clean ✓");
    } else {
      setSummary(`Found ${totalFound} issue(s); auto-fixed ${totalFixed}. Review steps marked in amber.`);
      toast.success(`Verify & Repair complete — fixed ${totalFixed}/${totalFound}`);
    }
  }

  const StatusIcon = ({ s }: { s: StepStatus }) => {
    if (s === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    if (s === "ok")      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (s === "warn")    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (s === "error")   return <XCircle className="h-4 w-4 text-destructive" />;
    return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Verify &amp; Repair (one click)
        </CardTitle>
        <CardDescription>
          Runs every integrity check on the active company's books in one pass — balance, orphans,
          duplicates, sequences, and the monthly snapshot — and auto-fixes what it safely can.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={run}
            disabled={running || !companyId}
            size="lg"
            className="shadow-md"
          >
            {running
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…</>
              : <><Play className="mr-2 h-4 w-4" /> Run Verify &amp; Repair</>}
          </Button>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
            <Switch
              id="auto-repair"
              checked={autoRepair}
              onCheckedChange={setAutoRepair}
              disabled={!isAdmin || running}
            />
            <Label htmlFor="auto-repair" className="flex items-center gap-1 text-sm">
              <Wrench className="h-3.5 w-3.5" /> Auto-repair safe issues
            </Label>
            {!isAdmin && (
              <Badge variant="secondary" className="text-[10px]">admin only</Badge>
            )}
          </div>
        </div>

        {summary && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{summary}</div>
        )}

        <div className="divide-y rounded-md border">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-start gap-3 px-3 py-2.5">
              <div className="mt-0.5"><StatusIcon s={s.status} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{s.label}</span>
                  {typeof s.found === "number" && s.found > 0 && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                      {s.found} found
                    </Badge>
                  )}
                  {typeof s.fixed === "number" && s.fixed > 0 && (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                      {s.fixed} fixed
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{s.message}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Auto-repair only deletes rows that are provably orphaned (no parent voucher). Unbalanced
          vouchers, duplicate numbers, and invalid amounts always require human review and are never
          auto-modified.
        </p>
      </CardContent>
    </Card>
  );
}
