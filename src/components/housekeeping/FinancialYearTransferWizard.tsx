import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Copy,
  Layers,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { formatINR } from "@/lib/money";
import { useCompany } from "@/lib/company-context";
import { describeError } from "@/lib/error-message";
import { cn } from "@/lib/utils";

type Mode = "extend" | "split";
type Step = 1 | 2 | 3 | 4;

interface Props {
  companyId: string | null;
  disabled?: boolean;
  fyStartHint?: string | null;
}

interface LedgerRow {
  id: string;
  name: string;
  type: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
  group_code: string | null;
  state: string | null;
  state_code: string | null;
  gstin: string | null;
  gst_treatment: string;
}
interface ItemRow {
  id: string;
  name: string;
  unit: string;
  hsn_code: string | null;
  gst_rate: number;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
  purchase_price_paise: number;
  sale_price_paise: number;
  reorder_level: number;
}

const PL_TYPES = new Set(["expense_direct", "expense_indirect", "income_direct", "income_indirect"]);

function fyFromHint(hint?: string | null) {
  const today = new Date();
  const year = today.getFullYear();
  const inFy = today.getMonth() >= 3;
  const startYear = hint ? new Date(hint).getFullYear() : (inFy ? year : year - 1);
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  const nextStart = `${startYear + 1}-04-01`;
  const nextEnd = `${startYear + 2}-03-31`;
  const fyLabel = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  const nextLabel = `${startYear + 1}-${String((startYear + 2) % 100).padStart(2, "0")}`;
  return { start, end, nextStart, nextEnd, fyLabel, nextLabel };
}

export function FinancialYearTransferWizard({ companyId, disabled, fyStartHint }: Props) {
  const { refresh, setActiveCompanyId, activeMembership } = useCompany();
  const fy = useMemo(() => fyFromHint(fyStartHint), [fyStartHint]);
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("extend");
  const [unreconciled, setUnreconciled] = useState<number>(0);
  const [negativeCash, setNegativeCash] = useState<{ name: string; paise: number }[]>([]);
  const [negativeStock, setNegativeStock] = useState<{ name: string; qty: number }[]>([]);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [newCompanyId, setNewCompanyId] = useState<string | null>(null);
  const [netProfitPaise, setNetProfitPaise] = useState<number>(0);
  const [newCompanyName, setNewCompanyName] = useState<string>("");

  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { primaryBtnRef.current?.focus(); }, [step]);

  const baseName = activeMembership?.companies?.name ?? "Company";
  useEffect(() => {
    setNewCompanyName(`${baseName} — FY ${fy.nextLabel}`);
  }, [baseName, fy.nextLabel]);

  // ----- Pre-checks ----------------------------------------------------------
  const runChecks = async () => {
    if (!companyId) return;
    setChecking(true);
    try {
      const [{ count: unrecon }, ledgersRes, entriesRes, itemsRes, movesRes] = await Promise.all([
        supabase
          .from("bank_statement_lines")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .neq("match_status", "matched"),
        supabase
          .from("ledgers")
          .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
          .eq("company_id", companyId)
          .in("type", ["cash", "bank"]),
        supabase
          .from("voucher_entries")
          .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
          .eq("vouchers.company_id", companyId)
          .lte("vouchers.voucher_date", fy.end),
        supabase
          .from("items")
          .select("id, name, opening_stock_qty")
          .eq("company_id", companyId),
        supabase
          .from("voucher_items")
          .select("qty, item_id, vouchers!inner(voucher_type, voucher_date, company_id)")
          .eq("vouchers.company_id", companyId)
          .lte("vouchers.voucher_date", fy.end),
      ]);
      setUnreconciled(unrecon ?? 0);

      const cashLedgers = (ledgersRes.data ?? []) as LedgerRow[];
      const ents = (entriesRes.data ?? []) as unknown as {
        ledger_id: string; debit_paise: number; credit_paise: number;
      }[];
      const move = new Map<string, number>();
      for (const e of ents) move.set(e.ledger_id, (move.get(e.ledger_id) ?? 0) + e.debit_paise - e.credit_paise);
      const negCash: { name: string; paise: number }[] = [];
      for (const l of cashLedgers) {
        const op = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
        const closing = op + (move.get(l.id) ?? 0);
        if (closing < 0) negCash.push({ name: l.name, paise: closing });
      }
      setNegativeCash(negCash);

      const items = (itemsRes.data ?? []) as { id: string; name: string; opening_stock_qty: number }[];
      const moves = (movesRes.data ?? []) as unknown as {
        qty: number; item_id: string; vouchers: { voucher_type: string };
      }[];
      const isIn = (t: string) => t === "purchase" || t === "credit_note";
      const isOut = (t: string) => t === "sales" || t === "debit_note";
      const isMfg = (t: string) => t === "manufacturing";
      const negStock: { name: string; qty: number }[] = [];
      for (const it of items) {
        let q = Number(it.opening_stock_qty) || 0;
        for (const m of moves) {
          if (m.item_id !== it.id) continue;
          const t = m.vouchers.voucher_type;
          const v = Number(m.qty);
          if (isMfg(t)) q += v;
          else if (isIn(t)) q += Math.abs(v);
          else if (isOut(t)) q -= Math.abs(v);
        }
        if (q < 0) negStock.push({ name: it.name, qty: q });
      }
      setNegativeStock(negStock);
    } catch (e) {
      toast.error(describeError(e) || "Pre-check failed");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (step === 2) void runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, companyId]);

  // ----- Execution -----------------------------------------------------------
  async function computeCarryForward() {
    if (!companyId) throw new Error("No company");
    const [ledgersRes, entriesRes, itemsRes, movesRes] = await Promise.all([
      supabase
        .from("ledgers")
        .select("id, name, type, opening_balance_paise, opening_balance_is_debit, group_code, state, state_code, gstin, gst_treatment")
        .eq("company_id", companyId),
      supabase
        .from("voucher_entries")
        .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
        .eq("vouchers.company_id", companyId)
        .lte("vouchers.voucher_date", fy.end),
      supabase
        .from("items")
        .select("id, name, unit, hsn_code, gst_rate, opening_stock_qty, opening_stock_rate_paise, purchase_price_paise, sale_price_paise, reorder_level")
        .eq("company_id", companyId),
      supabase
        .from("voucher_items")
        .select("qty, rate_paise, item_id, vouchers!inner(voucher_type, voucher_date, company_id)")
        .eq("vouchers.company_id", companyId)
        .lte("vouchers.voucher_date", fy.end),
    ]);
    if (ledgersRes.error) throw ledgersRes.error;
    if (entriesRes.error) throw entriesRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (movesRes.error) throw movesRes.error;

    const ledgers = (ledgersRes.data ?? []) as LedgerRow[];
    const ents = (entriesRes.data ?? []) as unknown as { ledger_id: string; debit_paise: number; credit_paise: number }[];
    const items = (itemsRes.data ?? []) as ItemRow[];
    const moves = (movesRes.data ?? []) as unknown as {
      qty: number; rate_paise: number; item_id: string; vouchers: { voucher_type: string };
    }[];

    const movement = new Map<string, number>();
    for (const e of ents) movement.set(e.ledger_id, (movement.get(e.ledger_id) ?? 0) + e.debit_paise - e.credit_paise);

    let np = 0; // Income - Expense
    const carriedLedgers: { src: LedgerRow; opening: number }[] = [];
    for (const l of ledgers) {
      const op = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
      const closing = op + (movement.get(l.id) ?? 0);
      if (PL_TYPES.has(l.type)) {
        // income natural Cr (negative signed) reduces NP if Dr, raises NP if Cr
        if (l.type.startsWith("income")) np += -closing; // closing negative means income → +
        else np += -closing; // expense closing positive means expense → -, so subtract
      } else {
        carriedLedgers.push({ src: l, opening: closing });
      }
    }
    setNetProfitPaise(np);

    const isIn = (t: string) => t === "purchase" || t === "credit_note";
    const isOut = (t: string) => t === "sales" || t === "debit_note";
    const isMfg = (t: string) => t === "manufacturing";
    const carriedItems: { src: ItemRow; qty: number; rate: number }[] = items.map((it) => {
      let q = Number(it.opening_stock_qty) || 0;
      let lastInRate = it.opening_stock_rate_paise;
      for (const m of moves) {
        if (m.item_id !== it.id) continue;
        const t = m.vouchers.voucher_type;
        const v = Number(m.qty);
        if (isMfg(t)) { q += v; if (v > 0 && m.rate_paise) lastInRate = m.rate_paise; }
        else if (isIn(t)) { q += Math.abs(v); if (m.rate_paise) lastInRate = m.rate_paise; }
        else if (isOut(t)) { q -= Math.abs(v); }
      }
      return { src: it, qty: q, rate: lastInRate || it.purchase_price_paise };
    });

    return { carriedLedgers, carriedItems, netProfitPaise: np };
  }

  async function executeExtend() {
    if (!companyId) return;
    // Just advance the FY pointer; history remains intact.
    const { error } = await supabase
      .from("companies")
      .update({ financial_year_start: fy.nextStart })
      .eq("id", companyId);
    if (error) throw error;
  }

  async function executeSplit() {
    if (!companyId) throw new Error("No company");
    const { carriedLedgers, carriedItems, netProfitPaise: np } = await computeCarryForward();

    // 1. Clone company (admin membership auto-created by trigger handle_new_company)
    const src = activeMembership?.companies;
    if (!src) throw new Error("Active company not loaded");
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) throw new Error("Not signed in");

    const { data: newCo, error: ce } = await supabase
      .from("companies")
      .insert({
        name: newCompanyName.trim() || `${baseName} — FY ${fy.nextLabel}`,
        entity_status: src.entity_status,
        cin: src.cin,
        share_capital_paise: src.share_capital_paise,
        corpus_fund_paise: src.corpus_fund_paise,
        gstin: src.gstin,
        state: src.state,
        state_code: src.state_code,
        financial_year_start: fy.nextStart,
        gst_registered: src.gst_registered,
        gst_filing_frequency: src.gst_filing_frequency,
        inventory_enabled: src.inventory_enabled,
        annual_turnover_paise: src.annual_turnover_paise,
        mode: src.mode,
        currency_code: src.currency_code ?? "INR",
        date_format: src.date_format ?? "dd-mm-yyyy",
        created_by: uid,
      })
      .select("id")
      .single();
    if (ce || !newCo) throw ce ?? new Error("Failed to create new company");
    const nid = newCo.id;
    setNewCompanyId(nid);

    // 2. Insert carried ledgers (BS only). P&L ledgers seeded with 0 opening.
    const ledgerRows = carriedLedgers.map(({ src: l, opening }) => ({
      company_id: nid,
      name: l.name,
      type: l.type as LedgerRow["type"],
      group_code: l.group_code,
      state: l.state,
      state_code: l.state_code,
      gstin: l.gstin,
      gst_treatment: l.gst_treatment as "regular",
      opening_balance_paise: Math.abs(opening),
      opening_balance_is_debit: opening >= 0,
    }));

    // Inject Retained Earnings / Profit & Loss A/c with NP as opening capital
    if (np !== 0) {
      ledgerRows.push({
        company_id: nid,
        name: "Profit & Loss A/c",
        type: "capital",
        group_code: "RESERVES_AND_SURPLUS",
        state: null,
        state_code: null,
        gstin: null,
        gst_treatment: "regular",
        opening_balance_paise: Math.abs(np),
        opening_balance_is_debit: np < 0, // profit (np>0) is Cr → is_debit=false
      });
    }

    if (ledgerRows.length) {
      // chunk insert to avoid payload limits
      for (let i = 0; i < ledgerRows.length; i += 200) {
        const { error } = await supabase.from("ledgers").insert(ledgerRows.slice(i, i + 200));
        if (error) throw error;
      }
    }

    // 3. Insert carried items
    const itemRows = carriedItems.map(({ src: it, qty, rate }) => ({
      company_id: nid,
      name: it.name,
      unit: it.unit,
      hsn_code: it.hsn_code,
      gst_rate: it.gst_rate,
      opening_stock_qty: qty,
      opening_stock_rate_paise: rate,
      purchase_price_paise: it.purchase_price_paise,
      sale_price_paise: it.sale_price_paise,
      reorder_level: it.reorder_level,
    }));
    if (itemRows.length) {
      for (let i = 0; i < itemRows.length; i += 200) {
        const { error } = await supabase.from("items").insert(itemRows.slice(i, i + 200));
        if (error) throw error;
      }
    }

    return nid;
  }

  const handleExecute = async () => {
    if (!companyId) return;
    setPosting(true);
    try {
      if (mode === "extend") {
        // compute NP for the success screen
        const { netProfitPaise: np } = await computeCarryForward();
        setNetProfitPaise(np);
        await executeExtend();
      } else {
        const nid = await executeSplit();
        await refresh();
        if (nid) setActiveCompanyId(nid);
      }
      if (mode === "extend") await refresh();
      setStep(4);
      toast.success(`Books carried forward to FY ${fy.nextLabel}`);
    } catch (e) {
      toast.error(describeError(e) || "Transfer failed");
    } finally {
      setPosting(false);
      setConfirmOpen(false);
    }
  };

  // ----- Keyboard ------------------------------------------------------------
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !confirmOpen && !posting) {
      e.preventDefault();
      if (step === 1) setStep(2);
      else if (step === 2) setStep(3);
      else if (step === 3) setConfirmOpen(true);
    }
  };

  // ----- Render --------------------------------------------------------------
  if (!companyId) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a company first.</CardContent></Card>;
  }
  const hasBlockers = false; // warnings only; user may proceed

  return (
    <div className="space-y-4" onKeyDown={onKey}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Year-End Closing &amp; Financial Year Transfer</CardTitle>
              <CardDescription>
                Carry balances from FY <strong>{fy.fyLabel}</strong> into FY <strong>{fy.nextLabel}</strong>.
              </CardDescription>
            </div>
            <StepDots step={step} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <div className="grid gap-3 md:grid-cols-2">
              <ModeCard
                active={mode === "extend"}
                icon={<Layers className="h-5 w-5" />}
                title="Generate New Financial Year"
                subtitle="Keep consolidated history"
                body="Append FY {next} to the same company. Switch between FYs freely. All vouchers, ledgers, and items remain in one place."
                next={fy.nextLabel}
                onClick={() => setMode("extend")}
              />
              <ModeCard
                active={mode === "split"}
                icon={<Copy className="h-5 w-5" />}
                title="Split Company &amp; Carry Forward"
                subtitle="Faster, isolated books"
                body="Create an independent copy for FY {next} with opening balances and stock seeded from this year's closing. Better for very large data sets."
                next={fy.nextLabel}
                onClick={() => setMode("split")}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Pre-flight checklist for FY {fy.fyLabel}</div>
              {checking ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Running checks…
                </div>
              ) : (
                <div className="space-y-2">
                  <CheckRow
                    label="Unreconciled bank transactions"
                    count={unreconciled}
                    detail={unreconciled > 0 ? "Reconcile in Bank &amp; Reconciliation before closing for clean opening balances." : "All bank lines matched."}
                  />
                  <CheckRow
                    label="Negative cash / bank balances"
                    count={negativeCash.length}
                    detail={negativeCash.length > 0
                      ? negativeCash.slice(0, 5).map((c) => `${c.name}: ${formatINR(c.paise)}`).join(" • ")
                      : "All cash/bank ledgers are positive."}
                  />
                  <CheckRow
                    label="Negative stock items"
                    count={negativeStock.length}
                    detail={negativeStock.length > 0
                      ? negativeStock.slice(0, 5).map((s) => `${s.name}: ${s.qty}`).join(" • ")
                      : "No negative stock detected."}
                  />
                </div>
              )}
              <Separator />
              <p className="text-xs text-muted-foreground">
                Warnings do not block the transfer, but it is best to clean them before carrying balances forward.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="font-medium">Review</div>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>• Mode: <strong>{mode === "extend" ? "Generate new FY (consolidated)" : "Split into new company"}</strong></li>
                  <li>• Closing FY: <strong>{fy.fyLabel}</strong> (ends {fy.end})</li>
                  <li>• New FY: <strong>{fy.nextLabel}</strong> (starts {fy.nextStart})</li>
                  <li>• Balance Sheet ledgers → carried as opening on {fy.nextStart}</li>
                  <li>• P&amp;L ledgers → reset to 0; net result transferred to Profit &amp; Loss A/c (Capital)</li>
                  <li>• Inventory → closing qty &amp; valuation become opening stock</li>
                </ul>
              </div>
              {mode === "split" && (
                <div className="space-y-1.5">
                  <Label htmlFor="newco">New company name</Label>
                  <Input
                    id="newco"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder={`${baseName} — FY ${fy.nextLabel}`}
                  />
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-6">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <div className="text-lg font-semibold">FY {fy.nextLabel} is ready</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {mode === "extend"
                    ? "Your company now operates on the new financial year. Previous year vouchers remain available for reports."
                    : "An independent copy has been created and is now active. Open Existing Companies to switch any time."}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs">
                Net {netProfitPaise >= 0 ? "Profit" : "Loss"} transferred:&nbsp;
                <strong>{formatINR(Math.abs(netProfitPaise))}</strong>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep((s) => Math.max(1, (s - 1) as Step))}
              disabled={step === 1 || step === 4 || posting}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {step < 3 && (
              <Button ref={primaryBtnRef} size="sm" onClick={() => setStep((s) => (s + 1) as Step)} disabled={disabled || checking}>
                Next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button ref={primaryBtnRef} size="sm" onClick={() => setConfirmOpen(true)} disabled={disabled || posting}>
                {posting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Execute Transfer
              </Button>
            )}
            {step === 4 && (
              <Button ref={primaryBtnRef} size="sm" onClick={() => { setStep(1); setNewCompanyId(null); }}>
                Done
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer balances to FY {fy.nextLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set up your new opening books on {fy.nextStart}.
              {mode === "split"
                ? " A new company will be created and made active."
                : " The current company's financial year will advance; historical vouchers stay accessible."}
              {(unreconciled > 0 || negativeCash.length > 0 || negativeStock.length > 0) && (
                <span className="mt-2 block rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
                  Warnings present: {unreconciled} unreconciled, {negativeCash.length} negative cash/bank, {negativeStock.length} negative stock.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecute} disabled={posting || hasBlockers}>
              {posting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Yes, carry forward
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/60" : "w-3 bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function ModeCard({
  active, icon, title, subtitle, body, next, onClick,
}: {
  active: boolean; icon: React.ReactNode; title: string; subtitle: string; body: string; next: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-lg border p-4 transition-all",
        active ? "border-primary/60 bg-primary/[0.04] shadow-sm ring-1 ring-primary/30" : "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium">{title}</div>
            {active && <Badge variant="secondary" className="text-[10px]">Selected</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {body.replace("{next}", next)}
          </p>
        </div>
      </div>
    </button>
  );
}

function CheckRow({ label, count, detail }: { label: string; count: number; detail: string }) {
  const tone = count === 0 ? "ok" : "warn";
  return (
    <div className={cn(
      "flex items-start justify-between gap-3 rounded-md border p-3 text-sm",
      tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5",
    )}>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5" dangerouslySetInnerHTML={{ __html: detail }} />
      </div>
      <Badge variant={tone === "ok" ? "secondary" : "destructive"} className="shrink-0">
        {count}
      </Badge>
    </div>
  );
}
