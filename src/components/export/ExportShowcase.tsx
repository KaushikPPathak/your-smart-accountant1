// Beautiful animated export overlay. Subscribes to the export overlay store
// and renders a delightful "live figure" while an export is in progress —
// a rotating conic-gradient progress ring, floating sheets/paper animation,
// live percentage, elapsed time, and (optional) Cancel button.
//
// The overlay is opt-in: showExportProgress() drives it for large exports,
// while smaller exports still get the sonner toast only.
import { useEffect, useState } from "react";
import { subscribeExportOverlay, type ExportOverlayState } from "@/lib/export-overlay-store";
import { FileSpreadsheet, FileText, FileJson, Sparkles, X } from "lucide-react";

const pickIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return FileSpreadsheet;
  if (n.endsWith(".json")) return FileJson;
  return FileText;
};

const fmtElapsed = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rs).padStart(2, "0")}`;
};

export function ExportShowcase() {
  const [state, setState] = useState<ExportOverlayState | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeExportOverlay(setState), []);
  useEffect(() => {
    if (!state || state.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state]);

  if (!state) return null;

  const Icon = pickIcon(state.fileName);
  const pct = state.total > 0 ? Math.min(100, Math.floor((state.done / state.total) * 100)) : 0;
  const elapsed = fmtElapsed(now - state.startedAt);
  const isDone = state.status === "done";
  const isFail = state.status === "failed";
  const ringAngle = isDone ? 360 : (pct / 100) * 360;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export in progress"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-[min(92vw,420px)] rounded-2xl border border-border/60 bg-card/95 shadow-2xl overflow-hidden">
        {/* Ambient aurora backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-24 opacity-70 blur-3xl"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(var(--primary)/0.35), hsl(var(--accent)/0.35), hsl(var(--primary)/0.10), hsl(var(--primary)/0.35))",
            animation: "export-aurora 8s linear infinite",
          }}
        />

        <div className="relative p-6 flex flex-col items-center">
          {/* Progress ring */}
          <div className="relative h-40 w-40 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full transition-[background] duration-300"
              style={{
                background: isFail
                  ? "conic-gradient(hsl(var(--destructive)) 360deg, hsl(var(--muted)) 0)"
                  : `conic-gradient(hsl(var(--primary)) ${ringAngle}deg, hsl(var(--muted)) 0)`,
                animation: state.status === "running" ? "export-spin 6s linear infinite" : undefined,
              }}
            />
            <div className="absolute inset-2 rounded-full bg-card" />
            <div className="relative flex flex-col items-center justify-center">
              <Icon className={`h-8 w-8 mb-1 ${isFail ? "text-destructive" : "text-primary"}`} />
              <div className="text-2xl font-semibold tabular-nums">
                {isDone ? "100%" : isFail ? "!" : `${pct}%`}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">{elapsed}</div>
            </div>

            {/* Floating sparkles */}
            {state.status === "running" && (
              <>
                <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-primary/70" style={{ animation: "export-float 2.4s ease-in-out infinite" }} />
                <Sparkles className="absolute -bottom-1 -left-2 h-3 w-3 text-accent-foreground/60" style={{ animation: "export-float 3.1s ease-in-out infinite", animationDelay: "0.6s" }} />
                <Sparkles className="absolute top-1/2 -left-3 h-3 w-3 text-primary/60" style={{ animation: "export-float 2.8s ease-in-out infinite", animationDelay: "1.1s" }} />
              </>
            )}
          </div>

          <div className="mt-5 text-center max-w-full">
            <div className="text-sm font-medium truncate max-w-[340px] mx-auto" title={state.fileName}>
              {isDone ? "Ready" : isFail ? "Export failed" : "Preparing"} · {state.fileName}
            </div>
            {state.stage && !isDone && !isFail && (
              <div className="mt-1 text-xs text-muted-foreground truncate max-w-[340px] mx-auto">
                {state.stage}
              </div>
            )}
            {state.total > 0 && !isFail && (
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {state.done.toLocaleString("en-IN")} / {state.total.toLocaleString("en-IN")} rows
              </div>
            )}
            {isFail && state.stage && (
              <div className="mt-1 text-xs text-destructive/90 max-w-[340px] mx-auto">{state.stage}</div>
            )}
          </div>

          {/* Linear progress bar */}
          <div className="mt-5 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${isFail ? "bg-destructive" : "bg-primary"}`}
              style={{
                width: `${isDone ? 100 : pct}%`,
                backgroundImage:
                  !isFail && state.status === "running"
                    ? "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.6) 50%, hsl(var(--primary)) 100%)"
                    : undefined,
                backgroundSize: "200% 100%",
                animation: state.status === "running" ? "export-shimmer 1.6s linear infinite" : undefined,
              }}
            />
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-2">
            {state.status === "running" && state.onCancel && (
              <button
                type="button"
                onClick={state.onCancel}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted transition"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            )}
            {(isDone || isFail) && (
              <button
                type="button"
                onClick={state.dismiss}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted transition"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes export-spin { to { transform: rotate(360deg); } }
        @keyframes export-aurora { to { transform: rotate(360deg); } }
        @keyframes export-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes export-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.85; }
          50% { transform: translateY(-6px) scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
