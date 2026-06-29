import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/lib/company-context";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports — Your Mehtaji" }] }),
  component: ReportsLayout,
});

type Tab = { to: string; label: string; requires?: "gst" | "inventory" };

const ALL_TABS: readonly Tab[] = [
  { to: "/app/reports/day-book", label: "Day Book" },
  { to: "/app/reports/ledger", label: "Ledger" },
  { to: "/app/reports/cash-bank", label: "Cash & Bank Book" },
  { to: "/app/reports/group-ledger", label: "Group Ledger (B/S & P&L)" },
  { to: "/app/reports/trial-balance", label: "Trial Balance" },
  { to: "/app/reports/trading", label: "Trading A/c", requires: "inventory" },
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
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-xs text-muted-foreground">Books of accounts, GST-ready summaries — date filters, PDF & Excel export.</p>
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
