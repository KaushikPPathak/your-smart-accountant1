// Mounts the assistant's background anomaly watchers for the active company.
//
// Renders nothing. Surfaces new danger/warn findings as sonner toasts with
// a deep link to the affected screen. Silent as long as the books stay
// clean; loud only when it matters.

import { useEffect } from "react";
import { toast } from "sonner";
import { useCompany } from "@/lib/company-context";
import { startWatchers } from "@/lib/ai/watchers";
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
      onNew(a) {
        const heading = `${catLabel[a.category]} — ${a.title}`;
        const opts = a.href
          ? { description: a.detail, action: { label: "Open", onClick: () => { window.location.hash = `#${a.href}`; } } }
          : { description: a.detail };
        if (a.severity === "danger") toast.error(heading, opts);
        else toast.warning(heading, opts);
      },
    });
    return () => handle.stop();
  }, [activeCompanyId]);

  return null;
}
