// Mounts the assistant's background anomaly watchers for the active company.
//
// Renders nothing. Surfaces new danger/warn findings as sonner toasts with
// a deep link to the affected screen. Silent as long as the books stay
// clean; loud only when it matters.

import { useEffect } from "react";
import { toast } from "sonner";
import { useCompany } from "@/lib/company-context";
import { startWatchers } from "@/lib/ai/watchers";
import { Button } from "@/components/ui/button";
import type { Anomaly } from "@/lib/ai/anomalies";

const catLabel: Record<Anomaly["category"], string> = {
  duplicate: "Duplicate voucher",
  msme: "MSMED §15",
  stock: "Negative stock",
  gst: "GST hygiene",
  deadline: "Filing deadline",
  balance: "Balance alert",
};

export function SilentWatchers() {
  const { activeCompanyId } = useCompany();

  useEffect(() => {
    if (!activeCompanyId) return;
    const handle = startWatchers(activeCompanyId, {
      onNew(a, actions) {
        const heading = `${catLabel[a.category]} — ${a.title}`;
        
        toast(heading, {
          description: a.detail,
          duration: 10000,
          action: a.href ? {
            label: "Open",
            onClick: () => { window.location.hash = `#${a.href}`; }
          } : undefined,
          cancel: {
            label: "Remind later",
            onClick: () => { void actions.snooze(); }
          },
          // sonner doesn't support multiple action buttons easily in the default toast,
          // but we can add a secondary button via description or custom toast if needed.
          // For now, let's use the 'never' as a standard button too.
          onAutoClose: () => {}, // no-op
          // We can use the 'Dismiss' button as 'Never' or add another action.
          // Sonner's toast allows a single action. We'll use a description link for 'Never'.
        });

        // To support "Never", we'll use a more advanced toast or just provide a second toast if they want to ignore.
        // Actually, Sonner supports custom components. Let's keep it simple with a specialized toast call.
        toast.custom((t) => (
          <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-4 shadow-lg animate-in slide-in-from-right">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{heading}</p>
                <p className="text-xs text-muted-foreground">{a.detail}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {a.href && (
                <Button size="sm" variant="default" onClick={() => { 
                  window.location.hash = `#${a.href}`;
                  toast.dismiss(t);
                }}>
                  Open
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { 
                void actions.snooze(); 
                toast.dismiss(t);
                toast.success("Will remind you in 4 hours.");
              }}>
                Remind later
              </Button>
              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => { 
                void actions.never(); 
                toast.dismiss(t);
                toast.info("Notification disabled for this item.");
              }}>
                Never
              </Button>
            </div>
          </div>
        ), { duration: 15000 });
      },
    });
    return () => handle.stop();
  }, [activeCompanyId]);

  return null;
}
