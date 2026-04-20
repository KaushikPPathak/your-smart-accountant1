import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports — Your Mehtaji" }] }),
  component: ReportsLayout,
});

const TABS = [
  { to: "/app/reports/day-book", label: "Day Book" },
  { to: "/app/reports/ledger", label: "Ledger" },
  { to: "/app/reports/trial-balance", label: "Trial Balance" },
  { to: "/app/reports/profit-loss", label: "Profit & Loss" },
  { to: "/app/reports/balance-sheet", label: "Balance Sheet" },
] as const;

function ReportsLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname === "/app/reports") {
      navigate({ to: "/app/reports/day-book", replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-xs text-muted-foreground">Books of accounts, GST-ready summaries — date filters & CSV export.</p>
      </div>
      <Card className="print:hidden">
        <CardContent className="p-2">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = location.pathname === t.to;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
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
