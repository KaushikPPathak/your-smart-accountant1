import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Wrench,
  Merge,
  RefreshCw,
  ShieldAlert,
  Hash,
  Database,
  Trash2,
  CheckCircle2,
  Upload,
  HardDrive,
  CalendarCheck,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { OpeningBalanceImport } from "@/components/housekeeping/OpeningBalanceImport";
import { OpeningStockImport } from "@/components/housekeeping/OpeningStockImport";
import { BackupRestoreTool } from "@/components/housekeeping/BackupRestoreTool";
import { YearEndClosure } from "@/components/housekeeping/YearEndClosure";
import { FinancialYearTransferWizard } from "@/components/housekeeping/FinancialYearTransferWizard";
import { YearEndLockToggle } from "@/components/housekeeping/YearEndLockToggle";
import { ReindexAndRepostTool } from "@/components/housekeeping/ReindexAndRepostTool";
import { SelfTestPanel } from "@/components/housekeeping/SelfTestPanel";
import { ImportHistoryPanel } from "@/components/housekeeping/ImportHistoryPanel";
const TallyBusyImport = lazy(() =>
  import("@/components/housekeeping/TallyBusyImport").then((m) => ({
    default: m.TallyBusyImport,
  })),
);
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { describeError } from "@/lib/error-message";
import { deactivateLedger as deactivateLedgerOff, deactivateItem as deactivateItemOff } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import {
  readItems,
  readLedgers,
  readVoucherEntriesForCompany,
  readVoucherItemsForCompany,
  readVouchers,
  shouldPreferOfflineCache,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/housekeeping")({
  head: () => ({ meta: [{ title: "Housekeeping — Accounting Tools" }] }),
  component: HousekeepingPage,
});

interface LedgerOpt {
  id: string;
  name: string;
  type: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

function HousekeepingPage() {
  const navigate = useNavigate({ from: "/app/housekeeping" });
  const search = useSearch({ from: "/app/housekeeping" }) as { tab?: string };
  const { activeCompanyId, activeMembership } = useCompany();
  const isAdmin = activeMembership?.role === "admin";
  const companyName = activeMembership?.companies?.name ?? "company";
  const inventoryEnabled = activeMembership?.companies?.inventory_enabled ?? true;
  const turnoverPaise = activeMembership?.companies?.annual_turnover_paise ?? 0;
  const currentTab = search.tab ?? "reindex_repost";

  const updateTab = (tab: string) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, tab }),
      replace: true,
      resetScroll: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wrench className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Housekeeping</h1>
          <p className="text-sm text-muted-foreground">
            Maintenance utilities for accounts: merge ledgers, renumber vouchers, verify integrity, and
            cleanup unused records.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Most housekeeping actions require <strong>Admin</strong> role.
          </CardContent>
        </Card>
      )}

      <Tabs value={currentTab} onValueChange={updateTab} activationMode="manual" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="verify">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Verify Books
          </TabsTrigger>
          <TabsTrigger value="recompute">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Recompute
          </TabsTrigger>
          <TabsTrigger value="cleanup">
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Cleanup
          </TabsTrigger>
          <TabsTrigger value="merge">
            <Merge className="mr-1 h-3.5 w-3.5" /> Merge Ledgers
          </TabsTrigger>
          <TabsTrigger value="renumber">
            <Hash className="mr-1 h-3.5 w-3.5" /> Renumber
          </TabsTrigger>
          <TabsTrigger value="opening">
            <Upload className="mr-1 h-3.5 w-3.5" /> Opening Balances
          </TabsTrigger>
          {inventoryEnabled && (
            <TabsTrigger value="opening_stock">
              <Upload className="mr-1 h-3.5 w-3.5" /> Opening Stock
            </TabsTrigger>
          )}
          <TabsTrigger value="tally">
            <Database className="mr-1 h-3.5 w-3.5" /> Tally / Busy
          </TabsTrigger>
          <TabsTrigger value="backup">
            <HardDrive className="mr-1 h-3.5 w-3.5" /> Backup / Restore
          </TabsTrigger>
          <TabsTrigger value="closure">
            <CalendarCheck className="mr-1 h-3.5 w-3.5" /> Year-End
          </TabsTrigger>
          <TabsTrigger value="fy_transfer">
            <CalendarCheck className="mr-1 h-3.5 w-3.5" /> FY Transfer
          </TabsTrigger>
          <TabsTrigger value="self_test">
            <Activity className="mr-1 h-3.5 w-3.5" /> Self-test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reindex_repost">
          <ReindexAndRepostTool companyId={activeCompanyId} />
        </TabsContent>

        <TabsContent value="opening">
          {activeCompanyId ? (
            <OpeningBalanceImport companyId={activeCompanyId} disabled={!isAdmin} />
          ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a company first.</CardContent></Card>}
        </TabsContent>
        {inventoryEnabled && (
          <TabsContent value="opening_stock">
            {activeCompanyId ? (
              <OpeningStockImport companyId={activeCompanyId} disabled={!isAdmin} annualTurnoverPaise={turnoverPaise} />
            ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a company first.</CardContent></Card>}
          </TabsContent>
        )}
        <TabsContent value="tally">
          {activeCompanyId ? (
            <div className="space-y-4">
              <Suspense fallback={<Card><CardContent className="p-6 text-sm text-muted-foreground">Loading importer…</CardContent></Card>}>
                <TallyBusyImport companyId={activeCompanyId} disabled={!isAdmin} />
              </Suspense>
              <ImportHistoryPanel companyId={activeCompanyId} disabled={!isAdmin} />
            </div>
          ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a company first.</CardContent></Card>}
        </TabsContent>
        <TabsContent value="backup">
          {activeCompanyId ? (
            <BackupRestoreTool
              companyId={activeCompanyId}
              companyName={companyName}
              partyCode={(activeMembership?.companies as { gstin?: string | null; pan?: string | null } | undefined)?.gstin
                ?? (activeMembership?.companies as { gstin?: string | null; pan?: string | null } | undefined)?.pan
                ?? null}
              disabled={!isAdmin}
            />
          ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a company first.</CardContent></Card>}
        </TabsContent>
        <TabsContent value="merge">
          <MergeLedgersTool companyId={activeCompanyId} disabled={!isAdmin} />
        </TabsContent>
        <TabsContent value="renumber">
          <RenumberVouchersTool companyId={activeCompanyId} disabled={!isAdmin} />
        </TabsContent>
        <TabsContent value="verify">
          <VerifyBooksTool companyId={activeCompanyId} />
        </TabsContent>
        <TabsContent value="cleanup">
          <CleanupTool companyId={activeCompanyId} disabled={!isAdmin} />
        </TabsContent>
        <TabsContent value="recompute">
          <RecomputeTool companyId={activeCompanyId} disabled={!isAdmin} />
        </TabsContent>
        <TabsContent value="closure">
          <YearEndClosure
            companyId={activeCompanyId}
            disabled={!isAdmin}
            fyStartHint={
              (activeMembership?.companies as { financial_year_start?: string | null } | undefined)
                ?.financial_year_start ?? null
            }
          />
        </TabsContent>
        <TabsContent value="fy_transfer" className="space-y-4">
          <YearEndLockToggle
            companyId={activeCompanyId}
            fyStart={
              (activeMembership?.companies as { financial_year_start?: string | null } | undefined)
                ?.financial_year_start ?? null
            }
            disabled={!isAdmin}
          />
          <FinancialYearTransferWizard
            companyId={activeCompanyId}
            disabled={!isAdmin}
            fyStartHint={
              (activeMembership?.companies as { financial_year_start?: string | null } | undefined)
                ?.financial_year_start ?? null
            }
          />
        </TabsContent>
        <TabsContent value="self_test">
          <SelfTestPanel companyId={activeCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Merge Ledgers — combine duplicate parties into one
// ============================================================================
function MergeLedgersTool({ companyId, disabled }: { companyId: string | null; disabled: boolean }) {
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("ledgers")
      .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setLedgers((data || []) as LedgerOpt[]));
  }, [companyId]);

  const source = ledgers.find((l) => l.id === sourceId);
  const target = ledgers.find((l) => l.id === targetId);
  const sameType = source && target && source.type === target.type;

  async function performMerge() {
    if (!companyId || !source || !target || source.id === target.id) return;
    setBusy(true);
    try {
      // 1. Re-point voucher_entries
      const { error: e1 } = await supabase
        .from("voucher_entries")
        .update({ ledger_id: target.id })
        .eq("ledger_id", source.id);
      if (e1) throw e1;

      // 2. Re-point vouchers.party_ledger_id
      const { error: e2 } = await supabase
        .from("vouchers")
        .update({ party_ledger_id: target.id })
        .eq("party_ledger_id", source.id)
        .eq("company_id", companyId);
      if (e2) throw e2;

      // 3. Re-point bill_allocations
      const { error: e3 } = await supabase
        .from("bill_allocations")
        .update({ ledger_id: target.id })
        .eq("ledger_id", source.id);
      if (e3) throw e3;

      // 4. Combine opening balances (signed sum)
      const sSign = source.opening_balance_is_debit ? 1 : -1;
      const tSign = target.opening_balance_is_debit ? 1 : -1;
      const combined =
        sSign * source.opening_balance_paise + tSign * target.opening_balance_paise;
      const { error: e4 } = await supabase
        .from("ledgers")
        .update({
          opening_balance_paise: Math.abs(combined),
          opening_balance_is_debit: combined >= 0,
        })
        .eq("id", target.id);
      if (e4) throw e4;

      // 5. Soft-delete source (mark inactive)
      const { error: e5 } = await supabase
        .from("ledgers")
        .update({ is_active: false })
        .eq("id", source.id);
      if (e5) throw e5;

      toast.success(`Merged "${source.name}" into "${target.name}"`);
      setSourceId("");
      setTargetId("");
      // refresh
      const { data } = await supabase
        .from("ledgers")
        .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");
      setLedgers((data || []) as LedgerOpt[]);
    } catch (err) {
      toast.error(`Merge failed: ${describeError(err)}`);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Merge className="h-4 w-4" /> Merge Duplicate Ledgers
        </CardTitle>
        <CardDescription>
          Combines all transactions, allocations, and openings of the source ledger into the target,
          then deactivates the source. Both must be the same ledger type.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Source (will be merged & deactivated)</Label>
          <Select value={sourceId} onValueChange={setSourceId} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Select source ledger" /></SelectTrigger>
            <SelectContent>
              {ledgers.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name} <span className="ml-2 text-[10px] text-muted-foreground">{l.type}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Target (will receive everything)</Label>
          <Select value={targetId} onValueChange={setTargetId} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Select target ledger" /></SelectTrigger>
            <SelectContent>
              {ledgers
                .filter((l) => l.id !== sourceId)
                .map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} <span className="ml-2 text-[10px] text-muted-foreground">{l.type}</span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {source && target && !sameType && (
          <div className="md:col-span-2 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            ⚠ Type mismatch: source is <strong>{source.type}</strong> but target is{" "}
            <strong>{target.type}</strong>. Merge blocked to prevent classification errors.
          </div>
        )}
        <div className="md:col-span-2 flex justify-end">
          <Button
            disabled={disabled || !source || !target || !sameType || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? "Merging…" : "Merge ledgers"}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm merge</AlertDialogTitle>
            <AlertDialogDescription>
              All vouchers, postings, and bill allocations of <strong>{source?.name}</strong> will be
              moved to <strong>{target?.name}</strong>. The source ledger will be deactivated. This
              action cannot be undone automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performMerge}>Yes, merge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============================================================================
// Renumber Vouchers — re-sequence by date for a voucher type
// ============================================================================
const VOUCHER_TYPES = [
  "sales", "purchase", "receipt", "payment", "journal", "contra",
  "credit_note", "debit_note", "quotation", "sales_order", "delivery_note",
] as const;

function RenumberVouchersTool({ companyId, disabled }: { companyId: string | null; disabled: boolean }) {
  const [type, setType] = useState<(typeof VOUCHER_TYPES)[number]>("sales");
  const [prefix, setPrefix] = useState("INV");
  const [start, setStart] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<{ id: string; old: string; new: string; date: string }[]>([]);

  async function loadPreview() {
    if (!companyId) return;
    const { data } = await supabase
      .from("vouchers")
      .select("id, voucher_number, voucher_date")
      .eq("company_id", companyId)
      .eq("voucher_type", type)
      .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true })
      .order("created_at", { ascending: true });
    const rows = (data || []) as { id: string; voucher_number: string; voucher_date: string }[];
    setPreview(
      rows.map((v, i) => ({
        id: v.id,
        old: v.voucher_number,
        date: v.voucher_date,
        new: `${prefix}/${String(start + i).padStart(4, "0")}`,
      })),
    );
  }

  async function applyRenumber() {
    setBusy(true);
    try {
      // Two-pass to avoid unique-constraint clashes: temp prefix then final
      const tmpUpdates = preview.map((p) =>
        supabase.from("vouchers").update({ voucher_number: `__TMP__${p.id.slice(0, 8)}` }).eq("id", p.id),
      );
      await Promise.all(tmpUpdates);
      const finalUpdates = preview.map((p) =>
        supabase.from("vouchers").update({ voucher_number: p.new }).eq("id", p.id),
      );
      const results = await Promise.all(finalUpdates);
      const fail = results.find((r) => r.error);
      if (fail?.error) throw fail.error;
      toast.success(`Renumbered ${preview.length} ${type} vouchers`);
      setPreview([]);
    } catch (err) {
      toast.error(`Renumber failed: ${describeError(err)}`);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Hash className="h-4 w-4" /> Renumber Vouchers (Year-end Resequence)
        </CardTitle>
        <CardDescription>
          Re-sequences voucher numbers in date order. Useful at year-end or after deletions left gaps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Voucher type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VOUCHER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Prefix</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label>Starting number</Label>
            <Input
              type="number"
              min={1}
              value={start}
              onChange={(e) => setStart(parseInt(e.target.value) || 1)}
              disabled={disabled}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={loadPreview} disabled={disabled} className="w-full">
              Preview
            </Button>
          </div>
        </div>

        {preview.length > 0 && (
          <>
            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead>Old Number</TableHead>
                    <TableHead>New Number</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 100).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.date}</TableCell>
                      <TableCell className="font-mono text-xs">{p.old}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{p.new}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > 100 && (
                <div className="border-t p-2 text-center text-xs text-muted-foreground">
                  Showing first 100 of {preview.length} vouchers.
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
                Apply renumber to {preview.length} vouchers
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm renumber</AlertDialogTitle>
            <AlertDialogDescription>
              {preview.length} {type} vouchers will be renumbered. Existing references in linked
              documents continue to point to the same vouchers. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyRenumber}>Yes, renumber</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============================================================================
// Verify Books — find unbalanced vouchers, orphaned entries
// ============================================================================
interface VoucherCheck {
  id: string;
  voucher_number: string;
  voucher_date: string;
  voucher_type: string;
  dr: number;
  cr: number;
  diff: number;
}

function VerifyBooksTool({ companyId }: { companyId: string | null }) {
  const [running, setRunning] = useState(false);
  const [unbalanced, setUnbalanced] = useState<VoucherCheck[]>([]);
  const [orphans, setOrphans] = useState<number>(0);
  const [hasRun, setHasRun] = useState(false);

  async function runChecks() {
    if (!companyId) return;
    setRunning(true);
    try {
      let vchs: { id: string; voucher_number: string; voucher_date: string; voucher_type: string }[] = [];
      let entries: { voucher_id: string; debit_paise: number; credit_paise: number }[] = [];

      const useCache = async () => {
        const { readVouchers, readVoucherEntries } = await import("@/lib/offline/cache-read");
        const cachedV = await readVouchers(companyId);
        vchs = cachedV.map((v: any) => ({
          id: v.id, voucher_number: v.voucher_number, voucher_date: v.voucher_date, voucher_type: v.voucher_type,
        }));
        const all: typeof entries = [];
        for (const v of vchs) {
          const ents = await readVoucherEntries(v.id);
          for (const e of ents as any[]) {
            all.push({ voucher_id: e.voucher_id, debit_paise: e.debit_paise ?? 0, credit_paise: e.credit_paise ?? 0 });
          }
        }
        entries = all;
      };

      if (!isOnlineNow()) {
        await useCache();
      } else {
        try {
          const { data: vData, error: vErr } = await supabase
            .from("vouchers")
            .select("id, voucher_number, voucher_date, voucher_type")
            .eq("company_id", companyId);
          if (vErr) throw vErr;
          const { data: eData, error: eErr } = await supabase
            .from("voucher_entries")
            .select("voucher_id, debit_paise, credit_paise, vouchers!inner(company_id)")
            .eq("vouchers.company_id", companyId);
          if (eErr) throw eErr;
          vchs = (vData || []) as any;
          entries = (eData || []) as any;
        } catch {
          await useCache();
        }
      }

      const totals = new Map<string, { dr: number; cr: number }>();
      for (const e of entries) {
        const cur = totals.get(e.voucher_id) || { dr: 0, cr: 0 };
        cur.dr += e.debit_paise;
        cur.cr += e.credit_paise;
        totals.set(e.voucher_id, cur);
      }

      const bad: VoucherCheck[] = [];
      for (const v of vchs) {
        const t = totals.get(v.id) || { dr: 0, cr: 0 };
        if (t.dr !== t.cr) bad.push({ ...v, dr: t.dr, cr: t.cr, diff: t.dr - t.cr });
      }
      setUnbalanced(bad);

      const voucherIds = new Set(vchs.map((v) => v.id));
      const orphanCount = entries.filter((e) => !voucherIds.has(e.voucher_id)).length;
      setOrphans(orphanCount);
      setHasRun(true);
      toast.success(isOnlineNow() ? "Verification complete" : "Verification complete (offline cache)");
    } catch (err) {
      toast.error(`Verification failed: ${describeError(err)}`);
    } finally {
      setRunning(false);
    }
  }


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4" /> Verify Books Integrity
        </CardTitle>
        <CardDescription>
          Scans every voucher to ensure debit = credit, and detects any orphaned posting rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={runChecks} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Scanning…" : "Run verification"}
        </Button>

        {hasRun && (
          <div className="grid gap-3 md:grid-cols-2">
            <Card className={unbalanced.length === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}>
              <CardContent className="p-3">
                <div className="text-xs uppercase text-muted-foreground">Unbalanced vouchers</div>
                <div className="text-2xl font-bold">{unbalanced.length}</div>
              </CardContent>
            </Card>
            <Card className={orphans === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}>
              <CardContent className="p-3">
                <div className="text-xs uppercase text-muted-foreground">Orphan posting rows</div>
                <div className="text-2xl font-bold">{orphans}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {unbalanced.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbalanced.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.voucher_date}</TableCell>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{v.voucher_type.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatINR(v.dr)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(v.cr)}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      {formatINR(Math.abs(v.diff))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Cleanup — find and remove unused ledgers/items
// ============================================================================
function CleanupTool({ companyId, disabled }: { companyId: string | null; disabled: boolean }) {
  const [unusedLedgers, setUnusedLedgers] = useState<{ id: string; name: string }[]>([]);
  const [unusedItems, setUnusedItems] = useState<{ id: string; name: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  async function scan() {
    if (!companyId) return;
    setScanning(true);
    try {
      const loaded = await withCacheFallback<{
        ledgers: { id: string; name: string }[];
        items: { id: string; name: string }[];
        entries: { ledger_id: string }[];
        vItems: { item_id: string }[];
        source: "cloud" | "cache";
      }>(
        async () => {
          const [ledgerRes, itemRes, entryRes, vItemRes] = await Promise.all([
            supabase.from("ledgers").select("id, name").eq("company_id", companyId).eq("is_active", true),
            supabase.from("items").select("id, name").eq("company_id", companyId).eq("is_active", true),
            supabase.from("voucher_entries").select("ledger_id, vouchers!inner(company_id)").eq("vouchers.company_id", companyId),
            supabase.from("voucher_items").select("item_id, vouchers!inner(company_id)").eq("vouchers.company_id", companyId),
          ]);
          const failed = [ledgerRes, itemRes, entryRes, vItemRes].find((r) => r.error);
          if (failed?.error) throw failed.error;
          return {
            ledgers: (ledgerRes.data || []) as { id: string; name: string }[],
            items: (itemRes.data || []) as { id: string; name: string }[],
            entries: (entryRes.data || []) as { ledger_id: string }[],
            vItems: (vItemRes.data || []) as { item_id: string }[],
            source: "cloud" as const,
          };
        },
        async () => ({
          ledgers: (await readLedgers(companyId))
            .filter((l: any) => l.is_active !== false)
            .map((l: any) => ({ id: String(l.id), name: String(l.name ?? "") })),
          items: (await readItems(companyId))
            .filter((i: any) => i.is_active !== false)
            .map((i: any) => ({ id: String(i.id), name: String(i.name ?? "") })),
          entries: ((await readVoucherEntriesForCompany(companyId)) as any[]).map((e) => ({ ledger_id: String(e.ledger_id ?? "") })),
          vItems: ((await readVoucherItemsForCompany(companyId)) as any[]).map((v) => ({ item_id: String(v.item_id ?? "") })),
          source: "cache" as const,
        }),
      );
      const { ledgers, items, entries, vItems } = loaded;
      const usedLedgerIds = new Set(((entries || []) as { ledger_id: string }[]).map((e) => e.ledger_id));
      const usedItemIds = new Set(((vItems || []) as { item_id: string }[]).map((v) => v.item_id));
      setUnusedLedgers(((ledgers || []) as { id: string; name: string }[]).filter((l) => !usedLedgerIds.has(l.id)));
      setUnusedItems(((items || []) as { id: string; name: string }[]).filter((i) => !usedItemIds.has(i.id)));
      setHasRun(true);
      if (loaded.source === "cache") toast.success("Cleanup scan completed from offline data");
    } catch (err) {
      toast.error(`Cleanup scan failed: ${describeError(err)}`);
    } finally {
      setScanning(false);
    }
  }

  async function deactivateLedger(id: string) {
    if (!companyId) return;
    try {
      await deactivateLedgerOff(id, companyId);
      setUnusedLedgers((l) => l.filter((x) => x.id !== id));
      toast.success(isLocalOnlyMode() || !isOnlineNow() ? "Ledger deactivated on this device" : "Ledger deactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }
  async function deactivateItem(id: string) {
    if (!companyId) return;
    try {
      await deactivateItemOff(id, companyId);
      setUnusedItems((l) => l.filter((x) => x.id !== id));
      toast.success(isLocalOnlyMode() || !isOnlineNow() ? "Item deactivated on this device" : "Item deactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trash2 className="h-4 w-4" /> Cleanup Unused Masters
        </CardTitle>
        <CardDescription>
          Finds ledgers and items that have never been used in any voucher and lets you deactivate them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={scan} disabled={scanning || disabled}>
          <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Scan for unused masters"}
        </Button>

        {hasRun && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold">
                Unused Ledgers <Badge variant="secondary">{unusedLedgers.length}</Badge>
              </div>
              <div className="max-h-60 overflow-auto rounded-md border">
                {unusedLedgers.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">All ledgers are in use ✓</div>
                ) : (
                  unusedLedgers.map((l) => (
                    <div key={l.id} className="flex items-center justify-between border-b px-3 py-2 last:border-0">
                      <span className="text-sm">{l.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => deactivateLedger(l.id)} disabled={disabled}>
                        Deactivate
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">
                Unused Items <Badge variant="secondary">{unusedItems.length}</Badge>
              </div>
              <div className="max-h-60 overflow-auto rounded-md border">
                {unusedItems.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">All items are in use ✓</div>
                ) : (
                  unusedItems.map((i) => (
                    <div key={i.id} className="flex items-center justify-between border-b px-3 py-2 last:border-0">
                      <span className="text-sm">{i.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => deactivateItem(i.id)} disabled={disabled}>
                        Deactivate
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Recompute — refresh next-voucher-number sequence + cached totals
// ============================================================================
function RecomputeTool({ companyId, disabled }: { companyId: string | null; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [snapBusy, setSnapBusy] = useState(false);

  async function recomputeSeq() {
    if (!companyId) return;
    setBusy(true);
    try {
      // For each voucher type, find max trailing number and reset next_number
      const loaded = await withCacheFallback<{
        source: "cloud" | "cache";
        vchs: { voucher_type: string; voucher_number: string }[];
      }>(
        async () => {
          const { data, error } = await supabase
            .from("vouchers")
            .select("voucher_type, voucher_number")
            .eq("company_id", companyId);
          if (error) throw error;
          return { source: "cloud" as const, vchs: (data || []) as { voucher_type: string; voucher_number: string }[] };
        },
        async () => {
          const cached = await readVouchers(companyId);
          return {
            source: "cache" as const,
            vchs: cached.map((v: any) => ({
              voucher_type: String(v.voucher_type ?? ""),
              voucher_number: String(v.voucher_number ?? ""),
            })),
          };
        },
      );
      const maxByType = new Map<string, number>();
      for (const v of loaded.vchs) {
        const m = v.voucher_number.match(/(\d+)\s*$/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        const cur = maxByType.get(v.voucher_type) || 0;
        if (n > cur) maxByType.set(v.voucher_type, n);
      }
      if (loaded.source === "cache") {
        toast.success(`Checked ${maxByType.size} voucher sequence(s) from offline cache — cloud update skipped until online`);
        return;
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
      toast.success(`Recomputed ${updated} voucher sequences`);
    } catch (err) {
      toast.error(`Recompute failed: ${describeError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function rebuildSnapshot() {
    if (!companyId) return;
    setSnapBusy(true);
    try {
      if (shouldPreferOfflineCache()) {
        toast.success("Offline reports use cached vouchers directly — monthly snapshot rebuild skipped until online");
        return;
      }
      const { data, error } = await supabase.rpc("recompute_monthly_balances", {
        _company_id: companyId,
      });
      if (error) throw error;
      toast.success(`Monthly balance snapshot rebuilt — ${data ?? 0} rows`);
    } catch (err) {
      toast.error(`Snapshot rebuild failed: ${describeError(err)}`);
    } finally {
      setSnapBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" /> Recompute Sequences
        </CardTitle>
        <CardDescription>
          After bulk imports, deletions, or renumbering, reset the next-voucher-number counter for each
          voucher type to one higher than the highest existing number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button onClick={recomputeSeq} disabled={busy || disabled}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Recomputing…" : "Recompute next-number for all voucher types"}
          </Button>
          <Button onClick={rebuildSnapshot} disabled={snapBusy || disabled} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${snapBusy ? "animate-spin" : ""}`} />
            {snapBusy ? "Rebuilding…" : "Rebuild monthly balance snapshot"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The monthly balance snapshot keeps Trial Balance, P&amp;L and Balance Sheet instant on large
          datasets. Rebuild after big imports, restores, or any direct database change.
        </p>
      </CardContent>
    </Card>
  );
}
