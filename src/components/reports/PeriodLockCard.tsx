import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Lock, Unlock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  fetchLockFor, lockPeriod, unlockPeriod,
  type PeriodLock, type ReturnType,
} from "@/lib/period-locks";
import { useCompany } from "@/lib/company-context";

interface Props {
  returnType: ReturnType;
  period: string;        // 'YYYY-MM' or 'YYYY-Qn'
  periodStart: string;   // ISO date
  periodEnd: string;     // ISO date
  periodLabel: string;   // human label e.g. "Apr 2026"
}

export function PeriodLockCard({ returnType, period, periodStart, periodEnd, periodLabel }: Props) {
  const { activeCompanyId, activeMembership } = useCompany();
  const isAdmin = activeMembership?.role === "admin";
  const [lock, setLock] = useState<PeriodLock | null>(null);
  const [loading, setLoading] = useState(false);
  const [filedRef, setFiledRef] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

  const refresh = async () => {
    if (!activeCompanyId) return;
    try {
      const l = await fetchLockFor(activeCompanyId, returnType, period);
      setLock(l);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    setFiledRef("");
    setUnlockReason("");
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, returnType, period]);

  const onLock = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      await lockPeriod({
        companyId: activeCompanyId,
        returnType,
        period,
        periodStart,
        periodEnd,
        filedReference: filedRef.trim() || undefined,
        notes: `Filed ${returnType} for ${periodLabel}`,
      });
      toast.success(`${returnType} ${periodLabel} marked as filed and locked.`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to lock period");
    } finally {
      setLoading(false);
    }
  };

  const onUnlock = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      await unlockPeriod({ companyId: activeCompanyId, returnType, period, reason: unlockReason });
      toast.success(`${returnType} ${periodLabel} unlocked. Edits are now allowed — please re-file when done.`);
      setUnlockOpen(false);
      setUnlockReason("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to unlock period");
    } finally {
      setLoading(false);
    }
  };

  const active = lock?.is_active === true;

  return (
    <Card>
      <CardContent className="p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            {active ? (
              <Badge variant="default" className="gap-1 bg-amber-600 hover:bg-amber-600">
                <Lock className="h-3 w-3" /> Locked — Filed
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Unlock className="h-3 w-3" /> Open for edits
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {returnType} · {periodLabel}
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-end gap-2">
            {!active ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">ARN / Filing reference (optional)</Label>
                  <Input
                    value={filedRef}
                    onChange={(e) => setFiledRef(e.target.value)}
                    placeholder="e.g. AA240000000000A"
                    className="h-9 w-[220px]"
                  />
                </div>
                <Button size="sm" onClick={onLock} disabled={loading || !isAdmin}>
                  <ShieldCheck className="mr-1 h-4 w-4" />
                  Mark as filed & lock
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUnlockOpen(true)}
                disabled={loading || !isAdmin}
              >
                <Unlock className="mr-1 h-4 w-4" /> Unlock (admin)
              </Button>
            )}
          </div>
        </div>

        {active && (
          <Alert className="mt-3 border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <Lock className="h-4 w-4" />
            <AlertTitle>This period is locked</AlertTitle>
            <AlertDescription className="text-xs">
              Vouchers dated between <strong>{lock?.period_start}</strong> and <strong>{lock?.period_end}</strong> cannot be added, edited, or deleted.
              Use a <strong>Credit Note</strong> or <strong>Debit Note</strong> in the current period to make corrections, which will appear in the next return as an amendment.
              {lock?.filed_reference && <> · Filing ref: <code>{lock.filed_reference}</code></>}
            </AlertDescription>
          </Alert>
        )}

        {!isAdmin && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only company admins can lock or unlock periods.
          </p>
        )}
      </CardContent>

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock {returnType} — {periodLabel}</DialogTitle>
            <DialogDescription>
              Unlocking a filed period is a serious action. The system will record this unlock with your name in the audit trail.
              Prefer using a Credit/Debit Note unless you genuinely need to revise the original return.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason (minimum 10 characters)</Label>
            <Input
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="e.g. Vendor invoice missed; revising GSTR-1 before due date"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {unlockReason.trim().length}/10 characters minimum
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={onUnlock}
              disabled={loading || unlockReason.trim().length < 10}
            >
              <Unlock className="mr-1 h-4 w-4" /> Unlock period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}