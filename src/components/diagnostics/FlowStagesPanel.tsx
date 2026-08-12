import * as React from "react";
import { listCrashes, type CrashEntry } from "@/lib/crash-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Activity } from "lucide-react";

/**
 * "Last run" panel — replays the most recent stage sequence of a flow
 * (print preview / WhatsApp share) in plain language, so a failure in a
 * packaged desktop build can be understood without a developer console.
 */

const FLOW_LABELS: Record<string, string> = {
  preview: "Print preview",
  whatsapp: "WhatsApp share",
};

const STAGE_TEXT: Record<string, string> = {
  start: "Started — locating the report on screen",
  clone: "Copied the report content",
  blob: "Built the preview document",
  window: "Opened the preview / WhatsApp window",
  written: "Checked the preview window content",
  pdf: "Generated the PDF file",
  "path-check": "Validated the file path",
  bridge: "Connected to the desktop bridge",
  clipboard: "Copied the file to the clipboard",
  url: "Prepared the WhatsApp link",
};

function describe(e: CrashEntry): string {
  if (e.kind === "stage") return STAGE_TEXT[e.message] ?? e.message;
  return e.message;
}

function lastRun(entries: CrashEntry[], scope: string): CrashEntry[] {
  // entries are newest-first; take everything back to the most recent "start"
  const forScope = entries.filter((e) => e.scope === scope);
  const out: CrashEntry[] = [];
  for (const e of forScope) {
    out.push(e);
    const isStart =
      e.kind === "stage" && (e.message === "start" || e.message === "pdf" || e.message === "bridge");
    if (isStart && out.length > 1) break;
  }
  return out.reverse().slice(-12);
}

export function FlowStagesPanel({ tick }: { tick?: number }) {
  const all = React.useMemo(() => listCrashes(), [tick]);

  const flows = ["preview", "whatsapp"].map((scope) => ({
    scope,
    label: FLOW_LABELS[scope] ?? scope,
    steps: lastRun(all, scope),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Last run — Print preview &amp; WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {flows.map((f) => (
          <div key={f.scope}>
            <div className="mb-2 text-sm font-medium">{f.label}</div>
            {f.steps.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                Not used yet on this device. Try it once, then come back here (Ctrl + Shift + D).
              </div>
            ) : (
              <ol className="space-y-1">
                {f.steps.map((s) => {
                  const failed = s.kind !== "stage";
                  return (
                    <li key={s.id} className="flex items-start gap-2 text-xs">
                      {failed ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      )}
                      <span className={failed ? "text-destructive" : ""}>
                        {describe(s)}
                        {s.context ? (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {JSON.stringify(s.context).slice(0, 160)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default FlowStagesPanel;
