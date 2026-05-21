import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Lock, Loader2, RefreshCw, ShieldCheck, Unlock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fyLabelFromStart,
  getFyLockStatus,
  lockFinancialYear,
  syncOpeningBalances,
  unlockFinancialYear,
  type FyLockStatus,
  type SyncResult,
} from "@/lib/fy-lock";
import { formatINR } from "@/lib/money";
import { describeError } from "@/lib/error-message";

interface Props {
  companyId: string | null;
  fyStart: string | null;
  disabled?: boolean;
}

export function YearEndLockToggle({ companyId, fyStart, disabled }: Props) {
  const [status, setStatus] = useState<FyLockStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lockConfirm, setLockConfirm] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const fyLabel = fyStart ? fyLabelFromStart(fyStart) : "—";

  async function refresh() {
    if (!companyId || !fyStart) return;
    setLoading(true);
    try {
      setStatus(await getFyLockStatus(companyId, fyStart));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, fyStart]);

  async function handleLock() {
    if (!companyId || !fyStart) return;
    setLoading(true);
    try {
      await lockFinancialYear({ companyId, fyStart });
      toast.success(`${fyLabel} is now frozen. No edits allowed.`);
      await refresh();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setLoading(false);
      setLockConfirm(false);
    }
  }

  async function handleUnlock() {
    if (!companyId || !fyStart) return;
    setLoading(true);
    try {
      await unlockFinancialYear({ companyId, fyStart, reason: unlockReason });
      toast.success(`${fyLabel} unlocked. Edits are again permitted.`);
      setUnlockReason("");
      await refresh();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setLoading(false);
      setUnlockOpen(false);
    }
  }

  async function handleSync() {
    if (!companyId || !fyStart) return;
    setSyncing(true);
    try {
      const result = await syncOpeningBalances(companyId, fyStart);
      setSyncResult(result);
      if (result.ledgers_updated === 0 && result.items_updated === 0) {
        toast.success("Opening balances already match the previous year's closing. Nothing to update.");
      } else {
        toast.success(
          `Synced opening balances — ${result.ledgers_updated} ledger(s), ${result.items_updated} item(s) updated.`,
        );
      }
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setSyncing(false);
    }
  }

  const noCompany = !companyId || !fyStart;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Provisional Sync & Year-End Lock
        </CardTitle>
        <CardDescription>
          Re-pull this year's opening balances from the previous FY's closing,
          and freeze the audited year so no further edits are possible.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {noCompany ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Select a company first.
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Current financial year
                  </div>
                  <div className="text-lg font-semibold">{fyLabel}</div>
                </div>
                {status?.locked ? (
                  <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Audited & Locked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Provisional
                  </Badge>
                )}
              </div>
              {status?.locked && status.lockedAt && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Locked on {new Date(status.lockedAt).toLocaleString("en-IN")}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">Sync Opening Balances from Previous Year</div>
                  <p className="text-xs text-muted-foreground">
                    Compares <strong>31 Mar</strong> closing against{" "}
                    <strong>1 Apr</strong> opening and fixes drift caused by
                    back-dated entries or audit adjustments.
                  </p>
                </div>
                <Button
                  onClick={handleSync}
                  disabled={disabled || syncing}
                  className="shrink-0"
                >
                  {syncing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Sync now
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">Freeze / Lock Financial Year Data</div>
                  <p className="text-xs text-muted-foreground">
                    When the audit is complete, freeze this year to prevent any
                    further add / edit / delete of vouchers dated within it.
                  </p>
                </div>
                <Switch
                  checked={!!status?.locked}
                  disabled={disabled || loading}
                  onCheckedChange={(v) => {
                    if (v) setLockConfirm(true);
                    else setUnlockOpen(true);
                  }}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={lockConfirm} onOpenChange={setLockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Freeze {fyLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Once frozen, <strong>no vouchers</strong> dated within {fyLabel}
              can be added, edited or deleted. You can unfreeze later with a
              recorded reason. Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLock} disabled={loading}>
              {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />}
              Yes, freeze year
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={unlockOpen} onOpenChange={(o) => { setUnlockOpen(o); if (!o) setUnlockReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unfreeze {fyLabel}</DialogTitle>
            <DialogDescription>
              Provide a reason (≥ 10 characters). This will be saved to the
              audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason</Label>
            <Textarea
              rows={3}
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="e.g. Auditor identified a missed expense voucher dated 28-Mar"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnlockOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleUnlock}
              disabled={loading || unlockReason.trim().length < 10}
            >
              {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unlock className="mr-1 h-4 w-4" />}
              Unfreeze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!syncResult} onOpenChange={(o) => { if (!o) setSyncResult(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Opening balance sync result</DialogTitle>
            <DialogDescription>
              Comparison of previous-year closing vs current-year opening.
            </DialogDescription>
          </DialogHeader>
          {syncResult && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="flex gap-3">
                <Badge variant="secondary">{syncResult.ledgers_updated} ledger(s) updated</Badge>
                <Badge variant="secondary">{syncResult.items_updated} item(s) updated</Badge>
              </div>
              {syncResult.ledger_details.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-semibold">Ledgers</div>
                  <div className="rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">Ledger</th>
                          <th className="p-2 text-right">Was</th>
                          <th className="p-2 text-right">Now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncResult.ledger_details.map((d) => (
                          <tr key={d.ledger_id} className="border-t">
                            <td className="p-2">{d.name}</td>
                            <td className="p-2 text-right font-mono">
                              {formatINR(d.old_paise)} {d.old_is_debit ? "Dr" : "Cr"}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {formatINR(d.new_paise)} {d.new_is_debit ? "Dr" : "Cr"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {syncResult.item_details.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-semibold">Items</div>
                  <div className="rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2 text-right">Old qty</th>
                          <th className="p-2 text-right">New qty</th>
                          <th className="p-2 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncResult.item_details.map((d) => (
                          <tr key={d.item_id} className="border-t">
                            <td className="p-2">{d.name}</td>
                            <td className="p-2 text-right font-mono">{d.old_qty}</td>
                            <td className="p-2 text-right font-mono">{d.new_qty}</td>
                            <td className="p-2 text-right font-mono">{formatINR(d.new_rate_paise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {syncResult.ledger_details.length === 0 && syncResult.item_details.length === 0 && (
                <div className="rounded-md border bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                  All opening balances already match the previous year's closing. No changes were needed.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSyncResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
