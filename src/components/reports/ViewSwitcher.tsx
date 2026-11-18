import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Table as TableIcon } from "lucide-react";

export type ReportView = "classic" | "grid";

/**
 * Remembers the Classic/Grid choice per report. On a phone with no saved choice,
 * `phoneInitial` is used (cards/Grid), so the desktop choice is never overwritten.
 */
export function useReportView(reportId: string, initial: ReportView = "classic", phoneInitial?: ReportView) {
  const key = `report-view:${reportId}`;
  const [view, setView] = useState<ReportView>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const saved = localStorage.getItem(key);
      if (saved === "classic" || saved === "grid") return saved;
    } catch { /* ignore */ }
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches;
    return phone && phoneInitial ? phoneInitial : initial;
  });
  useEffect(() => {
    try { localStorage.setItem(key, view); } catch { /* ignore */ }
  }, [key, view]);
  return { view, setView };
}

export function ViewSwitcher({
  view,
  onChange,
  classicLabel = "Classic",
}: {
  view: ReportView;
  onChange: (v: ReportView) => void;
  classicLabel?: string;
}) {
  return (
    <div className="flex gap-1">
      <Button size="sm" variant={view === "classic" ? "default" : "outline"} onClick={() => onChange("classic")}>
        <TableIcon className="mr-1 h-3.5 w-3.5" /> {classicLabel}
      </Button>
      <Button size="sm" variant={view === "grid" ? "default" : "outline"} onClick={() => onChange("grid")}>
        <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Grid
      </Button>
    </div>
  );
}
