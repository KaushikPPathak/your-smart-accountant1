import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePhone } from "@/hooks/use-phone";
import { useCompany } from "@/lib/company-context";
import { companyFeatures, isUrlEnabled } from "@/lib/company-features";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports — Your Mehtaji" }] }),
  component: ReportsLayout,
});

type Tab = { to: string; label: string; requires?: "gst" | "inventory" | "presumptive" };

const ALL_TABS: readonly Tab[] = [
  { to: "/app/reports/day-book", label: "Day Book" },
  { to: "/app/reports/ledger", label: "Ledger" },
  { to: "/app/reports/cash-bank", label: "Cash & Bank Book" },
  { to: "/app/reports/journal-book", label: "Journal Book" },
  { to: "/app/reports/receipts-payments", label: "Receipts & Payments" },

  { to: "/app/reports/group-ledger", label: "Group Ledger (B/S & P&L)" },
  { to: "/app/reports/trial-balance", label: "Trial Balance" },
  { to: "/app/reports/trading", label: "Trading A/c" },
  { to: "/app/reports/profit-loss", label: "P&L" },
  { to: "/app/reports/balance-sheet", label: "Balance Sheet" },
  { to: "/app/reports/outstanding", label: "Outstanding (Bill-wise)" },
  { to: "/app/reports/ageing", label: "Ageing" },
  { to: "/app/reports/receivables", label: "Receivables" },
  { to: "/app/reports/payables", label: "Payables" },
  { to: "/app/reports/sales-register", label: "Sales Register" },
  { to: "/app/reports/purchase-register", label: "Purchase Register" },
  { to: "/app/reports/gstr1", label: "GSTR-1", requires: "gst" },
  { to: "/app/reports/gstr3b", label: "GSTR-3B", requires: "gst" },
  { to: "/app/reports/gstr2b", label: "GSTR-2B Recon", requires: "gst" },
  { to: "/app/reports/brs", label: "Bank Recon (BRS)" },
  { to: "/app/reports/stock-summary", label: "Stock Summary", requires: "inventory" },
  { to: "/app/reports/hsn-summary", label: "HSN Summary", requires: "inventory" },
  { to: "/app/reports/itc-item-wise", label: "ITC Item-wise", requires: "gst" },
  { to: "/app/reports/itc-party-wise", label: "ITC Party-wise", requires: "gst" },
  { to: "/app/reports/presumptive", label: "Presumptive Tax", requires: "presumptive" },
  { to: "/app/reports/activity-log", label: "Activity Log" },
] as const;

function ReportsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeMembership } = useCompany();
  const features = companyFeatures(activeMembership?.companies as never);
  const gstRegistered = features.gst;
  const inventoryEnabled = features.inventory;
  const presumptiveEnabled = features.presumptive;

  const TABS = useMemo(
    () =>
      ALL_TABS.filter((t) => isUrlEnabled(t.to, features)),
    // features is rebuilt each render; the three flags are its only inputs.
    [gstRegistered, inventoryEnabled, presumptiveEnabled],
  );

  // On desktop, /app/reports opens Day Book. On phones it shows the report list instead.
  const phone = usePhone();
  useEffect(() => {
    if (!phone && location.pathname === "/app/reports") {
      navigate({ to: "/app/reports/day-book", replace: true });
    }
  }, [location.pathname, navigate, phone]);

  // Roving arrow-key navigation across report tabs. Left/Right (and Up/Down)
  // move focus between tabs without needing Tab; Home/End jump to first/last.
  // ArrowUp from any tab hops back into the Quick Entry ribbon so users can
  // reach the top regions without touching the mouse.
  const navRef = useRef<HTMLElement | null>(null);
  const onTabsKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const root = navRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[data-report-tab="true"]'));
    if (items.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? items.indexOf(current as HTMLAnchorElement) : -1;
    const focusAt = (i: number) => {
      const el = items[(i + items.length) % items.length];
      el?.focus();
    };
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusAt(idx < 0 ? 0 : idx + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        focusAt(idx < 0 ? 0 : idx - 1);
        return;
      case "ArrowUp": {
        e.preventDefault();
        const ribbon =
          document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"][role="button"]') ??
          document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"]');
        ribbon?.focus();
        return;
      }
      case "Home":
        e.preventDefault();
        focusAt(0);
        return;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        return;
      default:
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-xs text-muted-foreground">Books of accounts{gstRegistered ? ", GST-ready summaries" : ""} — date filters, PDF & Excel export.</p>
      </div>
      {phone && location.pathname === "/app/reports" && (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card print:hidden">
          {TABS.map((t) => (
            <li key={t.to}>
              <Link to={t.to} className="flex min-h-[52px] items-center justify-between px-4 text-[15px] active:bg-accent">
                {t.label}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {phone && location.pathname !== "/app/reports" && (
        <Link to="/app/reports" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary print:hidden">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
      )}
      <Card className="hidden print:hidden sm:block">
        <CardContent className="p-2">
          <nav
            ref={navRef}
            role="tablist"
            aria-label="Reports"
            className="flex flex-wrap gap-1"
            onKeyDown={onTabsKeyDown}
          >
            {TABS.map((t) => {
              const active = location.pathname === t.to;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  role="tab"
                  aria-selected={active}
                  data-report-tab="true"
                  tabIndex={active ? 0 : -1}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </CardContent>
      </Card>
      <Outlet />
    </div>
  );
}
