import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Plus, ChevronLeft, ChevronRight, Check, Settings, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany, type CompanyMembership } from "@/lib/company-context";
import { useI18n } from "@/lib/i18n";

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
  onEdit,
}: {
  m: CompanyMembership;
  isActive: boolean;
  onPick: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useI18n();
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
              {m.companies.gst_registered ? t("company.gst") : t("company.unreg")} • {m.role}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isActive && <Check className="h-4 w-4 text-primary" />}
            {m.role === "admin" && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(m.company_id); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("company.editAria")}
                title={t("company.editAria")}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-1.5 py-1">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-background"
            onClick={(e) => { e.stopPropagation(); setOffset((o) => o - 1); }}
            aria-label={t("company.prevYear")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-xs">{t("common.fy")} {fy}</span>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-background"
            onClick={(e) => { e.stopPropagation(); setOffset((o) => o + 1); }}
            aria-label={t("company.nextYear")}
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "list">("menu");
  const [hideTimer, setHideTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.top, left: r.right + 8 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => () => { if (hideTimer) clearTimeout(hideTimer); }, [hideTimer]);

  const show = () => {
    if (hideTimer) { clearTimeout(hideTimer); setHideTimer(null); }
    setOpen(true);
  };
  const scheduleHide = () => {
    const t = setTimeout(() => { setOpen(false); setView("menu"); }, 200);
    setHideTimer(t);
  };

  const onNew = () => {
    setOpen(false);
    setView("menu");
    navigate({ to: "/app/companies", search: { new: 1 } as never });
  };
  const onPick = (id: string) => {
    setActiveCompanyId(id);
    setOpen(false);
    setView("menu");
    navigate({ to: "/app" });
  };
  const onEdit = (id: string) => {
    setActiveCompanyId(id);
    setOpen(false);
    setView("menu");
    navigate({ to: "/app/companies", search: { edit: id } as never });
  };
  const onSettings = () => {
    setOpen(false);
    setView("menu");
    navigate({ to: "/app/settings" });
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
        ref={triggerRef}
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Building2 className="h-3.5 w-3.5" />
        <span>{t("company.flyoutTitle")}</span>
        <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div
          className="fixed z-[100] w-[22rem] max-w-[80vw] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {view === "menu" ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={onNew}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="h-4 w-4" />
                <span>{t("company.new")}</span>
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Building2 className="h-4 w-4" />
                <span>{t("company.existing")}</span>
                <span className="ml-auto text-xs text-muted-foreground">{memberships.length}</span>
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </button>
              <button
                type="button"
                onClick={onSettings}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Settings className="h-4 w-4" />
                <span>{t("nav.companySettings")}</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> {t("common.back")}
                </button>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("company.editPencilHint")}
                </span>
              </div>
              {memberships.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {t("company.noneYet")}.
                </div>
              ) : (
                <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {memberships.map((m) => (
                    <CompanyMiniCard
                      key={m.company_id}
                      m={m}
                      isActive={m.company_id === activeCompanyId}
                      onPick={onPick}
                      onEdit={onEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}