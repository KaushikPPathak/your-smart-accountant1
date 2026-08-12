import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { isDateLocked, type PeriodLock } from "@/lib/period-locks";
import { useCompany } from "@/lib/company-context";

/**
 * Shows a red banner when the chosen voucher date falls inside a locked
 * (already-filed) GST period. Use the returned `locked` flag to disable Save.
 */
export function usePeriodLock(date: string) {
  const { activeCompanyId } = useCompany();
  const [lock, setLock] = useState<PeriodLock | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeCompanyId || !date) {
        setLock(null);
        return;
      }
      const l = await isDateLocked(activeCompanyId, date);
      if (!cancelled) setLock(l);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, date]);

  return { lock, locked: !!lock };
}

export function PeriodLockBanner({ lock }: { lock: PeriodLock | null }) {
  if (!lock) return null;
  const isFy = String(lock.return_type) === "fy_close";
  return (
    <Alert variant="destructive" className="mb-3">
      <Lock className="h-4 w-4" />
      <AlertTitle>
        {isFy
          ? `This financial year is locked. No modifications allowed (${lock.period}).`
          : `This date is in a locked period (${lock.return_type} · ${lock.period})`}
      </AlertTitle>
      <AlertDescription className="text-xs">
        {isFy ? (
          <>
            The selected voucher date <strong>{new Date(lock.period_start).toLocaleDateString("en-IN")}</strong> – <strong>{new Date(lock.period_end).toLocaleDateString("en-IN")}</strong> falls inside an audited financial year. Pass any correction in the current open year, or ask an admin to unfreeze the year from Housekeeping → FY Transfer.
          </>
        ) : (
          <>
            The selected voucher date <strong>{new Date(lock.period_start).toLocaleDateString("en-IN")}</strong> – <strong>{new Date(lock.period_end).toLocaleDateString("en-IN")}</strong> has already been filed.
            Please raise a <strong>Credit Note</strong> or <strong>Debit Note</strong> in the current period instead, or ask an admin to unlock the period from the GSTR report.
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}