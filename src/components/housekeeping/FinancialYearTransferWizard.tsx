import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
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
import { offlineDb as db } from "@/lib/offline/db";
import {
  computeCarryData,
  buildTransferPreview,
  applyTransferPreview,
  extendFinancialYearLocal,
  type TransferPreview,
} from "@/lib/offline/fy-transfer";
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
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.searchStr), [location.searchStr]);

  useEffect(() => {
    // Auto-trigger step 3 if coming from the flyout "Create Next Year" command
    // We check for from_flyout or wizard=fy_transfer
    if (search.get("wizard") === "fy_transfer" || search.get("from_flyout")) {
      setStep(3);
      setMode("split");
    }
  }, [search]);

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
  const [preview, setPreview] = useState<TransferPreview | null>(null);

  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { primaryBtnRef.current?.focus(); }, [step]);

  const baseName = activeMembership?.companies?.name ?? "Company";
  useEffect(() => {
    setNewCompanyName(`${baseName} — FY ${fy.nextLabel}`);
  }, [baseName, fy.nextLabel]);

  // Live preview of what a split would add, change or remove (writes nothing).
  useEffect(() => {
    if (step !== 3 || mode !== "split" || !companyId) { setPreview(null); return; }
    let cancelled = false;
    buildTransferPreview({
      sourceId: companyId,
      fyEnd: fy.end,
      nextFyStart: fy.nextStart,
      nextName: newCompanyName.trim() || `${baseName} — FY ${fy.nextLabel}`,
    })
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e) => { if (!cancelled) toast.error(describeError(e) || "Preview failed"); });
    return () => { cancelled = true; };
  }, [step, mode, companyId, fy.end, fy.nextStart, fy.nextLabel, newCompanyName, baseName]);

  // ----- Pre-checks ----------------------------------------------------------
  const runChecks = async () => {
    if (!companyId) return;
    setChecking(true);
    try {
      const unrecon = await db.cache_bank_statement_lines
        .where("company_id").equals(companyId)
        .filter((l: { match_status?: string }) => l.match_status !== "matched")
        .count();
      setUnreconciled(unrecon);
      const d = await computeCarryData(companyId, fy.end);
      setNegativeCash(d.cashNegatives);
      setNegativeStock(d.negativeStock);
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
    const d = await computeCarryData(companyId, fy.end);
    return { netProfitPaise: d.netProfitPaise };
  }

  async function executeExtend() {
    if (!companyId) return;
    await extendFinancialYearLocal(companyId, fy.nextStart);
  }

  async function executeSplit() {
    if (!companyId) throw new Error("No company");
    const preview = await buildTransferPreview({
      sourceId: companyId,
      fyEnd: fy.end,
      nextFyStart: fy.nextStart,
      nextName: newCompanyName.trim() || `${baseName} — FY ${fy.nextLabel}`,
    });
    const nid = await applyTransferPreview(preview);
    setNewCompanyId(nid);
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
      const targetYear = search.get("target_year");
      toast.success(`Books carried forward to FY ${targetYear ? `${targetYear}-${String(parseInt(targetYear) + 1).slice(-2)}` : fy.nextLabel}`);
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
              {mode === "split" && preview && (
                <div className="rounded-lg border p-4 text-sm space-y-2">
                  <div className="font-medium">
                    {preview.targetId ? "Refresh the next-year company (already created)" : "Create the next-year company"}
                  </div>
                  <p className="text-muted-foreground">
                    Carried opening balances are replaced. Ledgers and items you added in the new year are kept.
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• Ledgers: {preview.ledgers.add.length} to add, {preview.ledgers.change.length} to update, {preview.ledgers.remove.length} to remove{preview.ledgers.keptInUse.length ? `, ${preview.ledgers.keptInUse.length} kept (used in new-year vouchers)` : ""}</li>
                    <li>• Items: {preview.items.add.length} to add, {preview.items.change.length} to update, {preview.items.remove.length} to remove{preview.items.keptInUse.length ? `, ${preview.items.keptInUse.length} kept (used in new-year vouchers)` : ""}</li>
                    <li>• Net {preview.netProfitPaise >= 0 ? "profit" : "loss"} to Profit &amp; Loss A/c: <strong>{formatINR(Math.abs(preview.netProfitPaise))}</strong></li>
                  </ul>
                  {[...preview.ledgers.handEdited, ...preview.items.handEdited].length > 0 && (
                    <div className="text-amber-700">
                      Changed by hand in the new year, will be replaced with the past-year figure: {[...preview.ledgers.handEdited, ...preview.items.handEdited].slice(0, 25).join(", ")}
                    </div>
                  )}
                  {[...preview.ledgers.clashes, ...preview.items.clashes].length > 0 && (
                    <div className="text-amber-700">
                      Same name already exists as a new-year row, so not carried: {[...preview.ledgers.clashes, ...preview.items.clashes].slice(0, 25).join(", ")}
                    </div>
                  )}
                  {preview.cashNegatives.length > 0 && (
                    <div className="text-amber-700">Negative cash/bank at year end: {preview.cashNegatives.map((c) => c.name).slice(0, 10).join(", ")}</div>
                  )}
                  {preview.negativeStock.length > 0 && (
                    <div className="text-amber-700">Negative stock at year end: {preview.negativeStock.map((s) => s.name).slice(0, 10).join(", ")}</div>
                  )}
                </div>
              )}
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
              onClick={() => setStep((s) => (Math.max(1, s - 1) as Step))}
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
