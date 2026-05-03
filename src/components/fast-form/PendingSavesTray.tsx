import { Loader2, RefreshCw, X } from "lucide-react";
import { dropPending, retryPending, usePendingSaves } from "@/lib/save-queue";
import { Button } from "@/components/ui/button";

export function PendingSavesTray() {
  const jobs = usePendingSaves();
  if (jobs.length === 0) return null;
  const failed = jobs.filter((j) => j.attempts > 0);
  return (
    <div className="fixed bottom-10 right-4 z-30 w-[320px] rounded-md border border-border bg-background/95 shadow-lg backdrop-blur print:hidden">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <span className="font-medium">
          {failed.length > 0 ? `${failed.length} failed save${failed.length === 1 ? "" : "s"}` : "Saving in background…"}
        </span>
        {failed.length > 0 && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={retryPending}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        )}
      </div>
      <ul className="max-h-48 overflow-auto py-1 text-xs">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-2 px-3 py-1">
            <span className="flex items-center gap-1.5 truncate">
              {j.attempts === 0 ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
              )}
              <span className="truncate" title={j.lastError ?? j.label}>{j.label}</span>
            </span>
            {j.attempts > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => dropPending(j.id)}
                title="Discard this save"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
