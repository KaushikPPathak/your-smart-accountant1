import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useSaveStatus, useFailureCount } from "@/lib/save-status";
import { useCurrentHints } from "./FocusHints";
import { BalanceStrip } from "./BalanceStrip";
import { cn } from "@/lib/utils";

interface Props {
  onOpenHelp: () => void;
  onOpenTray: () => void;
}

export function StatusBar({ onOpenHelp, onOpenTray }: Props) {
  const { lastSavedLabel, lastSavedAt } = useSaveStatus();
  const failureCount = useFailureCount();
  const hints = useCurrentHints();
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!lastSavedAt) return;
    setShowSuccess(true);
    const t = setTimeout(() => setShowSuccess(false), 1500);
    return () => clearTimeout(t);
  }, [lastSavedAt]);

  const alert = failureCount > 0;

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 hidden items-center justify-between gap-3 border-t px-4 py-1 text-[11px] backdrop-blur md:flex print:hidden transition-colors",
        alert
          ? "border-amber-400 bg-amber-100/80 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100 cursor-pointer"
          : showSuccess
            ? "border-emerald-400 bg-emerald-100/80 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
      onClick={alert ? onOpenTray : undefined}
      role={alert ? "button" : undefined}
      title={alert ? "Click to open pending saves" : undefined}
    >
      <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
        {alert ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {failureCount} background save{failureCount === 1 ? "" : "s"} failed — click to resolve
          </span>
        ) : showSuccess ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Check className="h-3.5 w-3.5" />
            Saved {lastSavedLabel}
          </span>
        ) : (
          hints.map((h, i) => {
            const [k, ...rest] = h.split(":");
            const v = rest.join(":").trim();
            return (
              <span key={i}>
                <kbd className="rounded border bg-background px-1 font-mono">{k}</kbd>
                {v && <> {v}</>}
              </span>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenHelp(); }}
        className="shrink-0 rounded border bg-background px-2 py-0.5 hover:bg-accent text-foreground"
      >
        <kbd className="font-mono">F1</kbd> Keyboard help
      </button>
    </div>
  );
}
