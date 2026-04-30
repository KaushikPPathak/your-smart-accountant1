import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Plus, ChevronLeft, ChevronRight, Check, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany, type CompanyMembership } from "@/lib/company-context";

// Compute the FY label (e.g. "2025-26") from a YYYY-MM-DD start string + offset (years).
function fyLabel(fyStart: string, offset: number) {
  const d = new Date(fyStart);
  const y = d.getFullYear() + offset;
  const yy = (y + 1) % 100;
  return `${y}-${String(yy).padStart(2, "0")}`;
}

function CompanyMiniCard({
  m,
  isActive,
  onPick,
}: {
  m: CompanyMembership;
  isActive: boolean;
  onPick: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const fy = useMemo(() => fyLabel(m.companies.financial_year_start, offset), [m.companies.financial_year_start, offset]);
  return (
    <Card
      className={`group relative cursor-pointer transition-colors hover:border-primary/60 ${
        isActive ? "border-primary ring-1 ring-primary/30" : ""
      }`}
      onClick={() => onPick(m.company_id)}
    >
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{m.companies.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {m.companies.gst_registered ? "GST" : "Unreg."} • {m.role}
            </div>
          </div>
          {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </div>
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-1.5 py-1">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-background"
            onClick={(e) => { e.stopPropagation(); setOffset((o) => o - 1); }}
            aria-label="Previous year"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-xs">FY {fy}</span>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-background"
            onClick={(e) => { e.stopPropagation(); setOffset((o) => o + 1); }}
            aria-label="Next year"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Hover-driven side panel for the Company menu.
 * Renders a small icon trigger; on hover (or focus) shows a panel to the right
 * with [+ New company] and the existing companies as compact FY cards.
 */
export function CompanyFlyout() {
  const navigate = useNavigate();
  const { memberships, activeCompanyId, setActiveCompanyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [hideTimer, setHideTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer) clearTimeout(hideTimer); }, [hideTimer]);

  const show = () => {
    if (hideTimer) { clearTimeout(hideTimer); setHideTimer(null); }
    setOpen(true);
  };
  const scheduleHide = () => {
    const t = setTimeout(() => setOpen(false), 180);
    setHideTimer(t);
  };

  const onNew = () => {
    setOpen(false);
    navigate({ to: "/app/companies", search: { new: 1 } as never });
  };
  const onPick = (id: string) => {
    setActiveCompanyId(id);
    setOpen(false);
    navigate({ to: "/app" });
  };

  return (
    <div
      className="relative"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Building2 className="h-3.5 w-3.5" />
        <span>Company</span>
        <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div
          className="absolute left-full top-0 z-50 ml-2 w-[22rem] max-w-[80vw] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Companies
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setOpen(false); navigate({ to: "/app/settings" }); }}>
              <Settings className="mr-1 h-3.5 w-3.5" /> Settings
            </Button>
          </div>

          <Button size="sm" className="mb-3 w-full justify-start" onClick={onNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New company
          </Button>

          {memberships.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No companies yet.
            </div>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
              {memberships.map((m) => (
                <CompanyMiniCard
                  key={m.company_id}
                  m={m}
                  isActive={m.company_id === activeCompanyId}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}