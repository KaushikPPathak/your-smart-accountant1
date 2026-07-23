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
      <div className="relative w-[min(88vw,300px)] rounded-xl border border-border/60 bg-card/95 shadow-xl overflow-hidden">
        {/* Ambient aurora backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-16 opacity-50 blur-2xl"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(var(--primary)/0.30), hsl(var(--accent)/0.25), hsl(var(--primary)/0.08), hsl(var(--primary)/0.30))",
            animation: "export-aurora 8s linear infinite",
          }}
        />

        <div className="relative px-4 py-3 flex flex-col items-center">
          {/* Progress ring */}
          <div className="relative h-20 w-20 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full transition-[background] duration-300"
              style={{
                background: isFail
                  ? "conic-gradient(hsl(var(--destructive)) 360deg, hsl(var(--muted)) 0)"
                  : `conic-gradient(hsl(var(--primary)) ${ringAngle}deg, hsl(var(--muted)) 0)`,
                animation: state.status === "running" ? "export-spin 6s linear infinite" : undefined,
              }}
            />
            <div className="absolute inset-1.5 rounded-full bg-card" />
            <div className="relative flex flex-col items-center justify-center leading-none">
              <Icon className={`h-4 w-4 mb-0.5 ${isFail ? "text-destructive" : "text-primary"}`} />
              <div className="text-sm font-semibold tabular-nums">
                {isDone ? "100%" : isFail ? "!" : `${pct}%`}
              </div>
              <div className="text-[9px] text-muted-foreground tabular-nums mt-0.5">{elapsed}</div>
            </div>

            {/* Floating sparkles */}
            {state.status === "running" && (
              <>
                <Sparkles className="absolute -top-0.5 -right-0.5 h-3 w-3 text-primary/70" style={{ animation: "export-float 2.4s ease-in-out infinite" }} />
                <Sparkles className="absolute -bottom-0.5 -left-1 h-2.5 w-2.5 text-accent-foreground/60" style={{ animation: "export-float 3.1s ease-in-out infinite", animationDelay: "0.6s" }} />
              </>
            )}
          </div>

          <div className="mt-2.5 text-center max-w-full">
            <div className="text-xs font-medium truncate max-w-[260px] mx-auto" title={state.fileName}>
              {isDone ? "Ready" : isFail ? "Export failed" : "Preparing"} · {state.fileName}
            </div>
            {state.stage && !isDone && !isFail && (
              <div className="mt-0.5 text-[10px] text-muted-foreground truncate max-w-[260px] mx-auto">
                {state.stage}
              </div>
            )}
            {state.total > 0 && !isFail && (
              <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                {state.done.toLocaleString("en-IN")} / {state.total.toLocaleString("en-IN")} rows
              </div>
            )}
            {isFail && state.stage && (
              <div className="mt-0.5 text-[10px] text-destructive/90 max-w-[260px] mx-auto">{state.stage}</div>
            )}
          </div>

          {/* Linear progress bar */}
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
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
          <div className="mt-2.5 flex items-center gap-2">
            {state.status === "running" && state.onCancel && (
              <button
                type="button"
                onClick={state.onCancel}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-muted transition"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            )}
            {(isDone || isFail) && (
              <button
                type="button"
                onClick={state.dismiss}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-muted transition"
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
