// Morning briefing card — the assistant's proactive surface on the dashboard.
//
// Loads a BriefingBundle on mount, shows a warm greeting, a compact KPI
// strip, and the anomaly list with severity colours and deep links.
// Dismissible per-day per-company (localStorage).

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, ChevronRight, Copy, Download, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { renderDigestText, copyDigest, downloadDigest } from "@/lib/ai/digest";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import {
  buildBriefing,
  briefingDismissed,
  dismissBriefing,
  type BriefingBundle,
} from "@/lib/ai/briefing";
import type { Anomaly, AnomalySeverity } from "@/lib/ai/anomalies";

interface Props {
  companyId: string;
  companyName?: string;
  userName?: string;
}

const sevStyle: Record<AnomalySeverity, string> = {
  danger: "border-l-destructive bg-destructive/5 text-destructive-foreground",
  warn:   "border-l-warning bg-warning/5",
  info:   "border-l-primary bg-primary/5",
};
const sevIcon: Record<AnomalySeverity, typeof AlertTriangle> = {
  danger: AlertTriangle,
  warn: AlertTriangle,
  info: Bell,
};
const catLabel: Record<Anomaly["category"], string> = {
  duplicate: "Duplicate",
  msme: "MSMED §15",
  stock: "Stock",
  gst: "GST",
  deadline: "Deadline",
  balance: "Balance",
};

export function MorningBriefing({ companyId, companyName, userName }: Props) {
  const [bundle, setBundle] = useState<BriefingBundle | null>(null);
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) return;
    if (briefingDismissed(companyId)) { setVisible(false); return; }
    (async () => {
      try {
        const b = await buildBriefing(companyId, { userName });
        if (!cancelled) setBundle(b);
      } catch {
        if (!cancelled) setBundle(null);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, userName]);

  if (!visible || !bundle || !bundle.hasContent) return null;

  const shown = expanded ? bundle.anomalies : bundle.anomalies.slice(0, 3);
  const hidden = bundle.anomalies.length - shown.length;

  return (
    <Card className="border-l-4 border-l-primary shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 rounded-full bg-primary/10 p-2">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">{bundle.greeting}</h2>
              <p className="text-xs text-muted-foreground">
                Your books for {companyName ? <span className="font-medium">{companyName}</span> : "this company"} —
                a quick look before you start.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
          <Button
            size="icon" variant="ghost"
            aria-label="Copy digest to clipboard"
            title="Copy this digest (paste into WhatsApp or email)"
            onClick={async () => {
              const ok = await copyDigest(renderDigestText(bundle, companyName));
              ok ? toast.success("Digest copied") : toast.error("Could not copy — use download instead");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            size="icon" variant="ghost"
            aria-label="Download digest as text file"
            title="Save this digest as a .txt file"
            onClick={() => downloadDigest(renderDigestText(bundle, companyName), `digest-${bundle.date}.txt`)}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            size="icon" variant="ghost"
            aria-label="Dismiss briefing for today"
            onClick={() => { dismissBriefing(companyId); setVisible(false); }}
          >
            <X className="h-4 w-4" />
          </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
          <Kpi label="Today's entries" value={String(bundle.kpis.todaysVouchers)} />
          <Kpi label="Sales (7 days)" value={formatINR(bundle.kpis.weekSalesPaise)} />
          <Kpi label="Purchase (7 days)" value={formatINR(bundle.kpis.weekPurchasePaise)} />
          <Kpi label="Last entry" value={bundle.kpis.lastVoucherDate ?? "—"} />
        </div>

        {bundle.anomalies.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            <span>Nothing needs your attention right now. Your books look clean.</span>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {bundle.anomalies.length} item{bundle.anomalies.length === 1 ? "" : "s"} to review
            </div>
            {shown.map((a) => {
              const Icon = sevIcon[a.severity];
              const inner = (
                <div className={`flex items-start gap-2 rounded-md border-l-2 px-3 py-2 ${sevStyle[a.severity]}`}>
                  <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider rounded bg-background/60 px-1.5 py-0.5">
                        {catLabel[a.category]}
                      </span>
                      <span className="text-sm font-medium truncate">{a.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>
                  </div>
                  {a.href ? <ChevronRight className="h-4 w-4 shrink-0 opacity-60" /> : null}
                </div>
              );
              return a.href
                ? <Link key={a.id} to={a.href} className="block hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring rounded-md">{inner}</Link>
                : <div key={a.id}>{inner}</div>;
            })}
            {hidden > 0 && !expanded ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} className="w-full">
                Show {hidden} more
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-medium truncate">{value}</div>
    </div>
  );
}
