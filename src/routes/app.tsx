import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Building2, HardDriveDownload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { QuickActionsRibbon } from "@/components/QuickActionsRibbon";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";
import { DateFormatSwitcher } from "@/components/DateFormatSwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";
import { useI18n } from "@/lib/i18n";
import {
  isCompanyUnlocked,
  lockWorkspace,
} from "@/lib/tech-user";
import { writeLocalMirror, getLastLocalMirror } from "@/lib/local-mirror";
import { runAppDataMigrationsOnce } from "@/lib/app-data-migrations";
import { isDesktopRuntime } from "@/lib/native-bridge";
import { AccountGroupsProvider } from "@/lib/account-groups-runtime";
import { KeyboardCheatSheet } from "@/components/vouchers/KeyboardCheatSheet";
import { MastersProvider } from "@/lib/masters-cache";
import { PendingSavesTray } from "@/components/fast-form/PendingSavesTray";
import { FocusHintsProvider } from "@/components/fast-form/FocusHints";
import { StatusBar } from "@/components/fast-form/StatusBar";
import { BackupNudgeBanner } from "@/components/BackupNudgeBanner";
import { DataOwnershipDialog } from "@/components/DataOwnershipDialog";
import { InstallAppButton } from "@/components/InstallAppButton";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Your Mehtaji — Workspace" }] }),
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { loading: companyLoading, memberships, activeCompanyId, activeMembership } = useCompany();
  const { t } = useI18n();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);
  const [lastSaveTick, setLastSaveTick] = useState(0); // forces re-render after save
  const [helpOpen, setHelpOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  const isTrial = activeMembership?.companies?.mode === "trial_local";
  const lastSaveAt = activeCompanyId ? getLastLocalMirror(activeCompanyId) : null;
  void lastSaveTick;
  const partyCode = (activeMembership?.companies as { gstin?: string | null; pan?: string | null } | undefined)?.gstin
    ?? (activeMembership?.companies as { gstin?: string | null; pan?: string | null } | undefined)?.pan
    ?? null;

  // Manual "Backup now" handler — silent. No toast on success; failures still
  // surface so the user knows if the disk write failed.
  const onBackupNow = async () => {
    if (!activeCompanyId || !activeMembership) return;
    setSavingMirror(true);
    try {
      await writeLocalMirror(activeCompanyId, activeMembership.companies.name, partyCode);
      setLastSaveTick((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message || "Local save failed");
    } finally {
      setSavingMirror(false);
    }
  };

  // Auto-save on app close for Trial / Local-only companies. This is the ONLY
  // place where we surface a closing notification — silent during normal work,
  // visible right before the window closes.
  useEffect(() => {
    if (!isTrial || !activeCompanyId || !activeMembership) return;
    const handler = () => {
      // Show a brief closing notification (visible until the window unloads).
      try {
        toast.message("Saving local backup before close…", {
          description: `${activeMembership.companies.name}${partyCode ? ` · ${partyCode}` : ""}`,
          duration: 8000,
        });
      } catch { /* ignore */ }
      // Fire and forget — beforeunload cannot await.
      void writeLocalMirror(activeCompanyId, activeMembership.companies.name, partyCode).catch(() => undefined);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isTrial, activeCompanyId, activeMembership, partyCode]);

  // Run one-time desktop data migrations + daily safety snapshot (safe no-op on web).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isDesktopRuntime()) {
          void runAppDataMigrationsOnce().catch(() => undefined);
          // Auto-snapshot every company once per day to APPLOCALDATA so a
          // Windows installer upgrade can never lose all data.
          if (memberships.length > 0) {
            const list = memberships
              .map((m) => ({ id: m.company_id, name: m.companies?.name ?? "company" }))
              .filter((c) => c.id);
            const { runAutoSnapshotOnce } = await import("@/lib/auto-snapshot");
            void runAutoSnapshotOnce(list).catch(() => undefined);
          }
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberships]);

  // No login screen any more — AuthProvider silently signs in a shared
  // tech user. We just wait for that to finish before rendering.


  // Global Busy-style hotkeys for new vouchers + Alt+L = jump to Ledger
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
      // F1: keyboard cheatsheet (always)
      if (e.key === "F1") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // Esc on a voucher entry page → back to vouchers list
      if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement | null;
        const inField = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
        const inDialog = target?.closest('[role="dialog"]');
        if (!inDialog && location.pathname.startsWith("/app/vouchers/new/")) {
          if (!inField) {
            e.preventDefault();
            navigate({ to: "/app/vouchers" });
            return;
          }
          // If inside a field, blur it first so a second Esc exits
          (target as HTMLElement | null)?.blur?.();
          return;
        }
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        // Remember where we came from so Esc on the Ledger report returns here.
        try {
          sessionStorage.setItem("ledgerReturnTo", location.pathname);
        } catch { /* ignore */ }
        navigate({ to: "/app/reports/ledger" });
        return;
      }
      const dest = map[e.key.toLowerCase()];
      if (dest) {
        e.preventDefault();
        navigate({ to: dest });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, location.pathname]);

  const onCompaniesPage = location.pathname.startsWith("/app/companies");
  const onAssistantPage = location.pathname.startsWith("/app/assistant");

  // Gate: every page under /app requires a chosen + unlocked company
  // (except /app/companies, which is reachable when the user clicked "+ New company")
  useEffect(() => {
    if (bootstrapping || loading || companyLoading) return;
    if (!user) return; // tech sign-in still in flight or failed
    if (memberships.length === 0) return; // empty-state handled below
    if (onCompaniesPage || onAssistantPage) return;
    if (!activeCompanyId || !isCompanyUnlocked(activeCompanyId)) {
      import("@/lib/return-to").then(({ rememberReturnTo }) => {
        rememberReturnTo(location.pathname + (typeof window !== "undefined" ? window.location.search : ""));
      });
      navigate({ to: "/" });
    }
  }, [bootstrapping, loading, companyLoading, user, memberships.length, activeCompanyId, onCompaniesPage, onAssistantPage, navigate]);

  if (bootstrapping || loading || !user || companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // No companies yet → invite to create one (allow assistant + companies pages through)
  if (memberships.length === 0 && !onCompaniesPage && !onAssistantPage) {
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
          <Link to="/app/companies" search={{ new: 1 } as never}>Create company</Link>
        </Button>
      </div>
    );
  }

  const onLock = async () => {
    await lockWorkspace();
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
              {/* Offline/online status is intentionally hidden — sync runs silently in the background. */}
              <InstallAppButton />
              <LanguageSwitcher compact />
              <CurrencySwitcher compact />
              <DateFormatSwitcher compact />
              {isTrial && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onBackupNow}
                    disabled={savingMirror}
                    className="gap-1.5"
                    title={lastSaveAt ? `Last local save: ${new Date(lastSaveAt).toLocaleString()}` : "Save a JSON + Excel copy to your PC now"}
                  >
                    {savingMirror ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline text-xs">{savingMirror ? "Saving…" : "Backup now"}</span>
                  </Button>
                  {lastSaveAt && !savingMirror && (
                    <span className="hidden text-[10px] text-muted-foreground md:inline" title={new Date(lastSaveAt).toLocaleString()}>
                      Saved {new Date(lastSaveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </>
              )}
              {activeMembership && (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                  <Building2 className="h-3.5 w-3.5" />
                  {activeMembership.companies.name}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={onLock} className="gap-2" title="Lock & return to company picker">
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">{t("common.lock")}</span>
              </Button>
            </div>
          </header>
          <BackupNudgeBanner />
          <AccountGroupsProvider>
          <MastersProvider>
          <FocusHintsProvider>
            <QuickActionsRibbon />
            <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">
              <Outlet />
            </main>
            <StatusBar onOpenHelp={() => setHelpOpen(true)} onOpenTray={() => setTrayOpen(true)} />
            <PendingSavesTray forceOpen={trayOpen} onClose={() => setTrayOpen(false)} />
          </FocusHintsProvider>
          </MastersProvider>
          </AccountGroupsProvider>
        </SidebarInset>
      </div>
      <KeyboardCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
      <DataOwnershipDialog />
    </SidebarProvider>
  );
}

