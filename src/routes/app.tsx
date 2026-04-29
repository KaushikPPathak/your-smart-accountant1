import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Building2 } from "lucide-react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { QuickActionsRibbon } from "@/components/QuickActionsRibbon";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";
import {
  ensureTechSession,
  isCompanyUnlocked,
  lockWorkspace,
} from "@/lib/tech-user";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Your Mehtaji — Workspace" }] }),
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { loading: companyLoading, memberships, activeCompanyId, activeMembership } = useCompany();
  const [bootstrapping, setBootstrapping] = useState(true);

  // Auto sign-in (silent) so RLS works. No user-visible login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureTechSession();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Global Busy-style hotkeys for new vouchers
  useEffect(() => {
    const map: Record<string, string> = {
      s: "/app/vouchers/new/sales",
      p: "/app/vouchers/new/purchase",
      r: "/app/vouchers/new/receipt",
      y: "/app/vouchers/new/payment",
      c: "/app/vouchers/new/credit_note",
      d: "/app/vouchers/new/debit_note",
      j: "/app/vouchers/new/journal",
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const dest = map[e.key.toLowerCase()];
      if (dest) {
        e.preventDefault();
        navigate({ to: dest });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const onCompaniesPage = location.pathname.startsWith("/app/companies");

  // Gate: every page under /app requires a chosen + unlocked company
  // (except /app/companies, which is reachable when the user clicked "+ New company")
  useEffect(() => {
    if (bootstrapping || loading || companyLoading) return;
    if (!user) return; // tech sign-in still in flight or failed
    if (memberships.length === 0) return; // empty-state handled below
    if (onCompaniesPage) return;
    if (!activeCompanyId || !isCompanyUnlocked(activeCompanyId)) {
      navigate({ to: "/" });
    }
  }, [bootstrapping, loading, companyLoading, user, memberships.length, activeCompanyId, onCompaniseFlag(onCompaniesPage), navigate]);

  if (bootstrapping || loading || !user || companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // No companies yet → invite to create one
  if (memberships.length === 0 && !onCompaniesPage) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xl">
          म
        </div>
        <h1 className="text-2xl font-semibold">Welcome to Your Mehtaji</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Create your first company to start invoicing, managing inventory and books.
        </p>
        <Button asChild>
          <Link to="/app/companies">Create company</Link>
        </Button>
      </div>
    );
  }

  const onLock = () => {
    lockWorkspace();
    navigate({ to: "/" });
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <CompanySwitcher />
            <div className="ml-auto flex items-center gap-2">
              {activeMembership && (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                  <Building2 className="h-3.5 w-3.5" />
                  {activeMembership.companies.name}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={onLock} className="gap-2" title="Lock & return to company picker">
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">Lock</span>
              </Button>
            </div>
          </header>
          <QuickActionsRibbon />
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

// Tiny helper so the dependency array stays primitive (avoid string churn)
function onCompaniseFlag(v: boolean) {
  return v ? 1 : 0;
}
