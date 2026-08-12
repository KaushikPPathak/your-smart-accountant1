import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Inline banner shown when a voucher form restores an autosaved draft from
 * a previous session. Not a toast — the user must acknowledge or discard so
 * nothing is silently overwritten.
 */
export function DraftRecoveredBanner({
  onDismiss,
  onDiscard,
}: {
  onDismiss: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">Draft recovered</div>
        <div className="text-xs opacity-80">
          Your last unsaved entries were restored. Continue editing, or discard to start fresh.
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onDiscard} className="h-7 text-xs">
        Discard
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss} className="h-7 px-1.5">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
