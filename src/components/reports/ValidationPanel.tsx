import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ValidationIssue } from "@/lib/gst-returns";

export function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4" /> All checks passed — ready to file.
      </div>
    );
  }
  const errs = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warning");
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        {errs.length ? <XCircle className="h-4 w-4 text-destructive" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
        {errs.length} error{errs.length === 1 ? "" : "s"} · {warns.length} warning{warns.length === 1 ? "" : "s"}
      </div>
      <ul className="max-h-48 divide-y overflow-auto text-xs">
        {issues.map((i, idx) => (
          <li key={idx} className="flex items-start gap-2 px-3 py-2">
            <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              i.level === "error"
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            }`}>{i.level === "error" ? "ERR" : "WARN"}</span>
            <span className="font-mono text-muted-foreground">{i.section}</span>
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
