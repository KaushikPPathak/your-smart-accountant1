import * as React from "react";
import { listCrashes, type CrashEntry } from "@/lib/crash-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 py-3 sm:py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Last run — Print preview &amp; WhatsApp
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 px-2 text-xs"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? "Hide details" : "View details"}
        </Button>
      </CardHeader>
      <CardContent className={cn("space-y-5", !showDetails && "pb-4")}>
        {flows.map((f) => (
          <div key={f.scope}>
            <div className="mb-2 text-sm font-medium">{f.label}</div>
            {f.steps.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                Not used yet on this device. Try it once, then come back here (Ctrl + Shift + D).
              </div>
            ) : (
              <ol className="space-y-1">
                {(showDetails ? f.steps : f.steps.filter(s => s.kind !== "stage")).map((s) => {
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
                        {showDetails && s.context ? (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {JSON.stringify(s.context).slice(0, 160)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
                {!showDetails && f.steps.every(s => s.kind === "stage") && f.steps.length > 0 && (
                  <li className="flex items-center gap-2 text-[10px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>All steps completed successfully</span>
                  </li>
                )}
              </ol>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default FlowStagesPanel;
