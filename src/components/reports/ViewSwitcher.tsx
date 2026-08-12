import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Table as TableIcon } from "lucide-react";

export type ReportView = "classic" | "grid";

export function useReportView(reportId: string, initial: ReportView = "classic") {
  const key = `report-view:${reportId}`;
  const [view, setView] = useState<ReportView>(() => {
    if (typeof window === "undefined") return initial;
    return ((localStorage.getItem(key) as ReportView) ?? initial);
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
