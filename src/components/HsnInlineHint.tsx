import { useEffect, useState } from "react";
import { lookupHsn, type HsnRecord } from "@/services/hsnService";

interface Props {
  code: string;
  /** Called once when a matching HSN record is found, so the parent can auto-fill fields. */
  onResolved?: (rec: HsnRecord) => void;
  className?: string;
}

/**
 * Looks up an HSN/SAC code in the local master table.
 * - If found: optionally fires onResolved (auto-populate description / tax rates).
 * - If not found: renders a non-blocking inline warning.
 * - Never throws; never interrupts the surrounding form flow.
 */
export function HsnInlineHint({ code, onResolved, className }: Props) {
  const [state, setState] = useState<"idle" | "checking" | "found" | "missing">("idle");

  useEffect(() => {
    const c = (code || "").trim();
    if (!c) { setState("idle"); return; }
    let cancelled = false;
    setState("checking");
    const handle = window.setTimeout(() => {
      lookupHsn(c)
        .then((res) => {
          if (cancelled) return;
          if (res.found && res.record) {
            setState("found");
            onResolved?.(res.record);
          } else {
            setState("missing");
          }
        })
        .catch(() => { if (!cancelled) setState("missing"); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (state === "missing") {
    return (
      <p className={`text-xs text-amber-600 dark:text-amber-400 ${className ?? ""}`}>
        HSN code not found in master database.
      </p>
    );
  }
  return null;
}
