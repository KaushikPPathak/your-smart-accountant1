import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatINR, rupeesToPaise } from "@/lib/money";
import type { LedgerTypeValue } from "@/lib/constants";

interface YearEndClosureProps {
  companyId: string | null;
  disabled?: boolean;
  fyStartHint?: string | null; // ISO date — financial year start from company settings
}

interface LedgerRow {
  id: string;
  name: string;
  type: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

interface EntryRow {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string; company_id: string };
}

interface JournalLine {
  ledger_id: string;
  ledger_name: string;
  debit_paise: number;
  credit_paise: number;
}

interface PreviewStep {
  key: "trading" | "pl" | "capital" | "closing_stock";
  title: string;
  narration: string;
  lines: JournalLine[];
  total_paise: number;
  resultLabel: string;
  resultPaise: number;
}

interface ClosingRunRow {
  id: string;
  fy_start: string;
  fy_end: string;
  closing_stock_paise: number;
  trading_voucher_id: string | null;
  pl_voucher_id: string | null;
  capital_voucher_id: string | null;
  closing_stock_voucher_id: string | null;
  status: string;
  performed_at: string;
}

const DIRECT_INCOME = "income_direct";
const INDIRECT_INCOME = "income_indirect";
const DIRECT_EXPENSE = "expense_direct";
const INDIRECT_EXPENSE = "expense_indirect";

function fyDefault(hint?: string | null) {
  // Indian FY: Apr 1 - Mar 31. Pick last completed FY by default.
  const today = new Date();
  const year = today.getFullYear();
  const inFy = today.getMonth() >= 3; // Apr or later -> FY started this year
  const startYear = (hint ? new Date(hint).getFullYear() : null) ?? (inFy ? year - 1 : year - 2);
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return { start, end };
}

async function ensureLedger(
  companyId: string,
  name: string,
  type: LedgerTypeValue,
): Promise<{ id: string; name: string }> {
  const { data: existing } = await supabase
    .from("ledgers")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing as { id: string; name: string };
  const { data: created, error } = await supabase
    .from("ledgers")
    .insert({ company_id: companyId, name, type })
    .select("id, name")
    .single();
  if (error) throw error;
  return created as { id: string; name: string };
}

export function YearEndClosure({ companyId, disabled, fyStartHint }: YearEndClosureProps) {
  const fy = useMemo(() => fyDefault(fyStartHint), [fyStartHint]);
  const [fyStart, setFyStart] = useState(fy.start);
  const [fyEnd, setFyEnd] = useState(fy.end);
  const [closingStockRupees, setClosingStockRupees] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [steps, setSteps] = useState<PreviewStep[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<ClosingRunRow[]>([]);
  const [reverseTarget, setReverseTarget] = useState<ClosingRunRow | null>(null);

  const loadHistory = async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("closing_runs")
      .select(
        "id, fy_start, fy_end, closing_stock_paise, trading_voucher_id, pl_voucher_id, capital_voucher_id, closing_stock_voucher_id, status, performed_at",
      )
      .eq("company_id", companyId)
      .order("performed_at", { ascending: false })
      .limit(10);
    setHistory((data || []) as ClosingRunRow[]);
  };

  useEffect(() => {
    void loadHistory();
    setSteps(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const buildPreview = async () => {
    if (!companyId) return;
    setLoading(true);
    setSteps(null);
    try {
      const closingStockPaise = rupeesToPaise(parseFloat(closingStockRupees) || 0);

      const { data: ledgersRaw, error: lErr } = await supabase
        .from("ledgers")
        .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", companyId);
      if (lErr) throw lErr;
      const ledgers = (ledgersRaw || []) as LedgerRow[];
      const byId = new Map(ledgers.map((l) => [l.id, l]));

      const { data: entriesRaw, error: eErr } = await supabase
        .from("voucher_entries")
        .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
        .eq("vouchers.company_id", companyId)
        .gte("vouchers.voucher_date", fyStart)
        .lte("vouchers.voucher_date", fyEnd);
      if (eErr) throw eErr;
      const entries = (entriesRaw || []) as unknown as EntryRow[];

      // Closing balance per ledger within FY (signed: +Dr / -Cr).
      // For income/expense ledgers, opening balance is normally zero, so we
      // count only this FY's movements (the standard treatment).
      const movement = new Map<string, number>();
      for (const e of entries) {
        movement.set(e.ledger_id, (movement.get(e.ledger_id) ?? 0) + e.debit_paise - e.credit_paise);
      }

      const buckets = {
        directExpense: [] as JournalLine[],
        directIncome: [] as JournalLine[],
        indirectExpense: [] as JournalLine[],
        indirectIncome: [] as JournalLine[],
      };
      let directExpenseTotal = 0;
      let directIncomeTotal = 0;
      let indirectExpenseTotal = 0;
      let indirectIncomeTotal = 0;

      for (const lg of ledgers) {
        const bal = movement.get(lg.id) ?? 0;
        if (bal === 0) continue;
        // Expenses: natural Dr balance (>0). To close, we Cr the ledger.
        // Incomes: natural Cr balance (<0). To close, we Dr the ledger.
        if (lg.type === DIRECT_EXPENSE && bal > 0) {
          buckets.directExpense.push({
            ledger_id: lg.id, ledger_name: lg.name,
            debit_paise: 0, credit_paise: bal,
          });
          directExpenseTotal += bal;
        } else if (lg.type === DIRECT_INCOME && bal < 0) {
          buckets.directIncome.push({
            ledger_id: lg.id, ledger_name: lg.name,
            debit_paise: -bal, credit_paise: 0,
          });
          directIncomeTotal += -bal;
        } else if (lg.type === INDIRECT_EXPENSE && bal > 0) {
          buckets.indirectExpense.push({
            ledger_id: lg.id, ledger_name: lg.name,
            debit_paise: 0, credit_paise: bal,
          });
          indirectExpenseTotal += bal;
        } else if (lg.type === INDIRECT_INCOME && bal < 0) {
          buckets.indirectIncome.push({
            ledger_id: lg.id, ledger_name: lg.name,
            debit_paise: -bal, credit_paise: 0,
          });
          indirectIncomeTotal += -bal;
        }
      }

      const previewSteps: PreviewStep[] = [];

      // STEP 1 — Closing Stock entry (Dr Closing Stock / Cr Trading)
      if (closingStockPaise > 0) {
        previewSteps.push({
          key: "closing_stock",
          title: "1. Closing Stock entry",
          narration: `Closing stock as on ${fyEnd} brought into books.`,
          lines: [
            { ledger_id: "__closing_stock__", ledger_name: "Closing Stock", debit_paise: closingStockPaise, credit_paise: 0 },
            { ledger_id: "__trading__", ledger_name: "Trading A/c", debit_paise: 0, credit_paise: closingStockPaise },
          ],
          total_paise: closingStockPaise,
          resultLabel: "Closing stock value",
          resultPaise: closingStockPaise,
        });
      }

      // STEP 2 — Trading A/c: transfer Direct Income (Dr) and Direct Expense (Cr)
      // Resulting balancing figure = Gross Profit (Dr Trading / Cr GP -> P&L)
      const tradingDr = directIncomeTotal; // we Dr direct-income ledgers
      const tradingCr = directExpenseTotal; // we Cr direct-expense ledgers
      // Gross Profit transferred from Trading -> P&L
      const gpPaise = (directIncomeTotal + closingStockPaise) - directExpenseTotal;
      if (buckets.directIncome.length || buckets.directExpense.length) {
        const tradingLines: JournalLine[] = [
          ...buckets.directIncome,            // Dr each direct income
          ...buckets.directExpense,           // Cr each direct expense
        ];
        // Trading A/c balancing line: Cr Trading by directIncomeTotal, Dr Trading by directExpenseTotal
        if (directIncomeTotal > 0)
          tradingLines.push({ ledger_id: "__trading__", ledger_name: "Trading A/c", debit_paise: 0, credit_paise: directIncomeTotal });
        if (directExpenseTotal > 0)
          tradingLines.push({ ledger_id: "__trading__", ledger_name: "Trading A/c", debit_paise: directExpenseTotal, credit_paise: 0 });
        previewSteps.push({
          key: "trading",
          title: "2. Transfer Direct Incomes & Direct Expenses to Trading A/c",
          narration: `Direct incomes & expenses for FY ${fyStart} to ${fyEnd} transferred to Trading A/c.`,
          lines: tradingLines,
          total_paise: Math.max(tradingDr, tradingCr),
          resultLabel: gpPaise >= 0 ? "Gross Profit (to P&L)" : "Gross Loss (to P&L)",
          resultPaise: Math.abs(gpPaise),
        });
      }

      // STEP 3 — P&L A/c: transfer GP/GL + Indirect Income (Dr) + Indirect Expense (Cr)
      // Net Profit = GP + Indirect Income - Indirect Expense
      const npPaise = gpPaise + indirectIncomeTotal - indirectExpenseTotal;
      if (buckets.indirectIncome.length || buckets.indirectExpense.length || gpPaise !== 0) {
        const plLines: JournalLine[] = [];
        // GP/GL coming in from Trading: Dr Trading / Cr P&L (GP) or Dr P&L / Cr Trading (GL)
        if (gpPaise > 0) {
          plLines.push({ ledger_id: "__trading__", ledger_name: "Trading A/c (Gross Profit b/d)", debit_paise: gpPaise, credit_paise: 0 });
          plLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: 0, credit_paise: gpPaise });
        } else if (gpPaise < 0) {
          plLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: -gpPaise, credit_paise: 0 });
          plLines.push({ ledger_id: "__trading__", ledger_name: "Trading A/c (Gross Loss b/d)", debit_paise: 0, credit_paise: -gpPaise });
        }
        // Indirect incomes: Dr each, Cr P&L total
        plLines.push(...buckets.indirectIncome);
        if (indirectIncomeTotal > 0)
          plLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: 0, credit_paise: indirectIncomeTotal });
        // Indirect expenses: Cr each, Dr P&L total
        plLines.push(...buckets.indirectExpense);
        if (indirectExpenseTotal > 0)
          plLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: indirectExpenseTotal, credit_paise: 0 });

        const totalAbs = plLines.reduce((s, l) => s + l.debit_paise + l.credit_paise, 0) / 2;
        previewSteps.push({
          key: "pl",
          title: "3. Transfer Gross Profit & Indirect items to Profit & Loss A/c",
          narration: `Indirect incomes/expenses & Gross Profit transferred to Profit & Loss A/c for FY ${fyStart} to ${fyEnd}.`,
          lines: plLines,
          total_paise: totalAbs,
          resultLabel: npPaise >= 0 ? "Net Profit (to Capital)" : "Net Loss (to Capital)",
          resultPaise: Math.abs(npPaise),
        });
      }

      // STEP 4 — Transfer Net Profit/Loss to Capital
      // Pick first capital ledger; we'll let user know if none.
      const capitalLedger = ledgers.find((l) => l.type === "capital");
      if (npPaise !== 0) {
        const capLines: JournalLine[] = [];
        if (npPaise > 0) {
          capLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: npPaise, credit_paise: 0 });
          capLines.push({
            ledger_id: capitalLedger?.id ?? "__capital__",
            ledger_name: capitalLedger?.name ?? "Capital A/c",
            debit_paise: 0,
            credit_paise: npPaise,
          });
        } else {
          capLines.push({
            ledger_id: capitalLedger?.id ?? "__capital__",
            ledger_name: capitalLedger?.name ?? "Capital A/c",
            debit_paise: -npPaise,
            credit_paise: 0,
          });
          capLines.push({ ledger_id: "__pl__", ledger_name: "Profit & Loss A/c", debit_paise: 0, credit_paise: -npPaise });
        }
        previewSteps.push({
          key: "capital",
          title: "4. Transfer Net Profit / Loss to Capital A/c",
          narration: `Net ${npPaise >= 0 ? "Profit" : "Loss"} for FY ${fyStart} to ${fyEnd} transferred to Capital A/c.`,
          lines: capLines,
          total_paise: Math.abs(npPaise),
          resultLabel: npPaise >= 0 ? "Added to Capital" : "Reduced from Capital",
          resultPaise: Math.abs(npPaise),
        });
      }

      if (previewSteps.length === 0) {
        toast.info("No income/expense balances or closing stock to close for this period.");
      }
      // Avoid unused var lint on byId — kept for future per-ledger lookups.
      void byId;
      setSteps(previewSteps);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to build preview");
    } finally {
      setLoading(false);
    }
  };

  const postClosure = async () => {
    if (!companyId || !steps || steps.length === 0) return;
    setPosting(true);
    try {
      const closingStockPaise = rupeesToPaise(parseFloat(closingStockRupees) || 0);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // Ensure required system ledgers
      const tradingLg = await ensureLedger(companyId, "Trading A/c", "income_direct");
      const plLg = await ensureLedger(companyId, "Profit & Loss A/c", "capital");
      const closingStockLg = closingStockPaise > 0
        ? await ensureLedger(companyId, "Closing Stock", "stock_in_hand")
        : null;

      // Find/create capital ledger if needed
      let capitalLg = (await supabase
        .from("ledgers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("type", "capital")
        .neq("id", plLg.id)
        .limit(1)
        .maybeSingle()).data as { id: string; name: string } | null;
      if (!capitalLg) capitalLg = await ensureLedger(companyId, "Capital A/c", "capital");

      const resolveLedgerId = (placeholder: string): string => {
        if (placeholder === "__trading__") return tradingLg.id;
        if (placeholder === "__pl__") return plLg.id;
        if (placeholder === "__capital__") return capitalLg!.id;
        if (placeholder === "__closing_stock__") return closingStockLg!.id;
        return placeholder;
      };

      const createdIds: Record<PreviewStep["key"], string | null> = {
        trading: null, pl: null, capital: null, closing_stock: null,
      };

      // Order: closing_stock -> trading -> pl -> capital
      const ordered = [...steps].sort((a, b) => {
        const order = { closing_stock: 0, trading: 1, pl: 2, capital: 3 } as const;
        return order[a.key] - order[b.key];
      });

      for (const step of ordered) {
        const totalDr = step.lines.reduce((s, l) => s + l.debit_paise, 0);
        const totalCr = step.lines.reduce((s, l) => s + l.credit_paise, 0);
        if (totalDr !== totalCr || totalDr === 0) {
          throw new Error(`${step.title}: Debit/Credit mismatch (${totalDr} vs ${totalCr})`);
        }

        const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
          _company_id: companyId,
          _type: "journal",
        });
        if (numErr) throw numErr;

        const { data: vData, error: vErr } = await supabase
          .from("vouchers")
          .insert({
            company_id: companyId,
            created_by: user.id,
            voucher_type: "journal",
            voucher_number: numData as string,
            voucher_date: fyEnd,
            narration: step.narration,
            subtotal_paise: totalDr,
            total_paise: totalDr,
            is_interstate: false,
          })
          .select("id")
          .single();
        if (vErr) throw vErr;

        const entries = step.lines.map((l, i) => ({
          voucher_id: vData.id,
          ledger_id: resolveLedgerId(l.ledger_id),
          line_no: i + 1,
          debit_paise: l.debit_paise,
          credit_paise: l.credit_paise,
          narration: null,
        }));
        const { error: eErr } = await supabase.from("voucher_entries").insert(entries);
        if (eErr) throw eErr;

        createdIds[step.key] = vData.id;
      }

      const { error: rErr } = await supabase.from("closing_runs").insert({
        company_id: companyId,
        fy_start: fyStart,
        fy_end: fyEnd,
        closing_stock_paise: closingStockPaise,
        trading_voucher_id: createdIds.trading,
        pl_voucher_id: createdIds.pl,
        capital_voucher_id: createdIds.capital,
        closing_stock_voucher_id: createdIds.closing_stock,
        status: "completed",
        performed_by: user.id,
      });
      if (rErr) throw rErr;

      toast.success("Year-end closure posted as Journal vouchers.");
      setSteps(null);
      setConfirmOpen(false);
      await loadHistory();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to post closure");
    } finally {
      setPosting(false);
    }
  };

  const reverseRun = async (run: ClosingRunRow) => {
    if (!companyId) return;
    try {
      const ids = [
        run.closing_stock_voucher_id,
        run.trading_voucher_id,
        run.pl_voucher_id,
        run.capital_voucher_id,
      ].filter(Boolean) as string[];
      if (ids.length === 0) {
        toast.info("Nothing to reverse — no vouchers attached to this run.");
        return;
      }
      const { error } = await supabase.from("vouchers").delete().in("id", ids);
      if (error) throw error;
      await supabase.from("closing_runs").update({ status: "reversed" }).eq("id", run.id);
      toast.success("Closure reversed — journal vouchers deleted.");
      await loadHistory();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to reverse");
    } finally {
      setReverseTarget(null);
    }
  };

  if (!companyId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Select a company first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" />
          <CardTitle>Year-End Closure</CardTitle>
        </div>
        <CardDescription>
          Auto-generates the standard Indian closing entries — Closing Stock, transfers to Trading A/c
          and Profit &amp; Loss A/c, and the final Net Profit / Loss transfer to Capital A/c. Each step
          is posted as a separate dated Journal voucher you can review or delete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>FY start</Label>
            <FyDatePicker value={fyStart} onChange={setFyStart} unrestricted />
          </div>
          <div className="space-y-1">
            <Label>FY end</Label>
            <FyDatePicker value={fyEnd} onChange={setFyEnd} unrestricted />
          </div>
          <div className="space-y-1">
            <Label>Closing stock value (₹)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={closingStockRupees}
              onChange={(e) => setClosingStockRupees(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={buildPreview} disabled={loading || disabled}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1 h-4 w-4" />}
            Preview closing entries
          </Button>
          {steps && steps.length > 0 && (
            <Button variant="default" onClick={() => setConfirmOpen(true)} disabled={posting || disabled}>
              <ShieldCheck className="mr-1 h-4 w-4" /> Post {steps.length} Journal{steps.length > 1 ? "s" : ""}
            </Button>
          )}
          {disabled && <Badge variant="outline">Admin only</Badge>}
        </div>

        {steps && steps.length > 0 && (
          <div className="space-y-3">
            {steps.map((step) => (
              <div key={step.key} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                  <span>{step.title}</span>
                  <span className="text-xs text-muted-foreground">{step.resultLabel}: <strong className="text-foreground">{formatINR(step.resultPaise)}</strong></span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[55%]">Ledger</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {step.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.ledger_name}</TableCell>
                        <TableCell className="text-right font-mono">{l.debit_paise ? formatINR(l.debit_paise) : ""}</TableCell>
                        <TableCell className="text-right font-mono">{l.credit_paise ? formatINR(l.credit_paise) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              All entries will be posted dated <strong>{fyEnd}</strong>. Missing system ledgers (Trading A/c,
              Profit &amp; Loss A/c, Closing Stock, Capital A/c) will be created automatically.
            </p>
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Recent closure runs</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>FY</TableHead>
                  <TableHead>Posted</TableHead>
                  <TableHead>Closing Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.fy_start} → {r.fy_end}</TableCell>
                    <TableCell>{new Date(r.performed_at).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono">{formatINR(r.closing_stock_paise)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "default" : "outline"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.status === "completed" && (
                        <Button size="sm" variant="ghost" onClick={() => setReverseTarget(r)} disabled={disabled}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reverse
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post year-end closure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create {steps?.length ?? 0} Journal voucher(s) dated <strong>{fyEnd}</strong>.
              You can reverse the run later by clicking <em>Reverse</em> in the history table — that
              deletes the journals so you can re-run with corrected figures.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={postClosure} disabled={posting}>
              {posting ? "Posting…" : "Post journals"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reverseTarget} onOpenChange={(o) => !o && setReverseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this closure run?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the journal vouchers created by this closure ({reverseTarget?.fy_start} → {reverseTarget?.fy_end}).
              The run will be marked <em>reversed</em>. This action cannot be undone — you will need to re-run the closure to reapply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reverseTarget && reverseRun(reverseTarget)}>
              Reverse closure
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}