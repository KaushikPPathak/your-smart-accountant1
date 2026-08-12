import { Button } from "@/components/ui/button";
import { useFyRange } from "@/components/ui/fy-date-picker";
import { format } from "date-fns";
import { useMemo } from "react";

/**
 * Small chip row that narrows the report date range with one click.
 *
 * Why: on large books (5k+ vouchers/year), opening a report on the full FY
 * loads every row into the DOM. These chips let the user pull down a much
 * smaller slice (this month / last 30 days / this quarter) BEFORE the query
 * runs, so the DB fetch, JS aggregation, and DOM paint all get cheaper.
 *
 * Safe by design: this only calls the caller's existing `onChange(from, to)`
 * — it doesn't touch export/print pipelines, doesn't hide rows client-side,
 * and doesn't change the default range. Users who ignore it get today's
 * behavior unchanged.
 */
interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Hide the "Full FY" chip (e.g. when a screen never wants a full-year default). */
  hideFullFy?: boolean;
}

function iso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function QuickRangeChips({ from, to, onChange, hideFullFy }: Props) {
  const { start: fyStart, end: fyEnd } = useFyRange();

  const ranges = useMemo(() => {
    const today = new Date();
    // Clamp helpers keep every quick range inside the active FY so we never
    // accidentally query dates outside the company's books.
    const clamp = (d: Date): Date => {
      if (d < fyStart) return fyStart;
      if (d > fyEnd) return fyEnd;
      return d;
    };

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const last30Start = new Date(today);
    last30Start.setDate(last30Start.getDate() - 29);

    const q = Math.floor(today.getMonth() / 3);
    const qStart = new Date(today.getFullYear(), q * 3, 1);
    const qEnd = new Date(today.getFullYear(), q * 3 + 3, 0);

    return [
      { key: "today", label: "Today", from: iso(clamp(today)), to: iso(clamp(today)) },
      { key: "last30", label: "Last 30d", from: iso(clamp(last30Start)), to: iso(clamp(today)) },
      { key: "month", label: "This month", from: iso(clamp(monthStart)), to: iso(clamp(monthEnd)) },
      { key: "quarter", label: "This quarter", from: iso(clamp(qStart)), to: iso(clamp(qEnd)) },
      { key: "fy", label: "Full FY", from: iso(fyStart), to: iso(fyEnd) },
    ];
  }, [fyStart, fyEnd]);

  return (
    <div className="flex flex-wrap items-center gap-1 print:hidden" role="group" aria-label="Quick date ranges">
      <span className="mr-1 text-[11px] uppercase tracking-wider text-muted-foreground">Quick range:</span>
      {ranges.map((r) => {
        if (hideFullFy && r.key === "fy") return null;
        const active = r.from === from && r.to === to;
        return (
          <Button
            key={r.key}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            aria-pressed={active}
            onClick={() => onChange(r.from, r.to)}
          >
            {r.label}
          </Button>
        );
      })}
    </div>
  );
}
