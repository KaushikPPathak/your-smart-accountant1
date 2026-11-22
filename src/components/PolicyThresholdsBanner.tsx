// One line when this device is not using the company's synced thresholds. The app then uses the
// defaults, so the banner says so rather than letting two devices quietly disagree.

import { useEffect, useState } from "react";
import { useCompany } from "@/lib/company-context";
import { loadPolicyStatus, type PolicyStatus } from "@/lib/policy-settings";

const REASON_TEXT: Record<"missing" | "newer_version" | "invalid", string> = {
  missing: "Thresholds not yet synced for this company. Defaults are in use until this device receives them.",
  invalid: "Thresholds for this company could not be read. Defaults are in use; check the company record.",
  newer_version: "This company's thresholds use a newer format. Update the app. Defaults are in use until then.",
};

export function PolicyThresholdsBanner() {
  const { activeCompanyId } = useCompany();
  const [status, setStatus] = useState<PolicyStatus>({ synced: true });

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    const check = () => {
      void loadPolicyStatus(activeCompanyId).then((r) => { if (!cancelled) setStatus(r.status); });
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeCompanyId]);

  if (status.synced) return null;
  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      {REASON_TEXT[status.reason]}
    </div>
  );
}
