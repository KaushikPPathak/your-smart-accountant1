// Shows a warning when the startup SQLite integrity check failed. It only informs:
// it does not change or delete any data. The user can dismiss it for this session.

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { lastIntegrityResult, shouldShowIntegrityWarning, type IntegrityResult } from "@/lib/sqlite-integrity";

const DISMISS_KEY = "integrity_banner_dismissed_for";

export function IntegrityFailedBanner() {
  const [result, setResult] = useState<IntegrityResult | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const r = lastIntegrityResult();
      let dismissed: string | null = null;
      try { dismissed = sessionStorage.getItem(DISMISS_KEY); } catch { /* unavailable */ }
      if (shouldShowIntegrityWarning(r, dismissed) && r) setResult(r);
    }, 300);
    return () => window.clearTimeout(id);
  }, []);

  if (!result) return null;

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, result!.checkedAt); } catch { /* unavailable */ }
    setResult(null);
  }

  return (
    <div role="alert" className="flex items-start gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <strong>The book file failed its integrity check.</strong>
        <span> Nothing has been changed. Back up your company data now and contact support before making more entries. Detail: {result.detail}</span>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded p-1 hover:bg-red-100 dark:hover:bg-red-900">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
