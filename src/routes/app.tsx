import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
// (icons for backup button moved into TopMenuBar Administration menu)
import { toast } from "sonner";
import { TopMenuBar } from "@/components/TopMenuBar";
import { QuickActionsRibbon } from "@/components/QuickActionsRibbon";
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
import { BalancesProvider } from "@/lib/balances-cache";
import { PendingSavesTray } from "@/components/fast-form/PendingSavesTray";
import { FocusHintsProvider } from "@/components/fast-form/FocusHints";
import { StatusBar } from "@/components/fast-form/StatusBar";
import { BackupNudgeBanner } from "@/components/BackupNudgeBanner";
import { DataOwnershipDialog } from "@/components/DataOwnershipDialog";
import { UpdateRecoveryBanner } from "@/components/UpdateRecoveryBanner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { KeyboardProvider, useShortcut } from "@/lib/keyboard";
import { CalculatorDialog } from "@/components/CalculatorDialog";

import { getLicenseState, isReadOnlyLocked } from "@/lib/license/state";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Your Mehtaji — Workspace" }] }),
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  useAuth(); // keeps AuthProvider subscription mounted; we don't gate on it here
  const { loading: companyLoading, memberships, activeCompanyId, activeMembership } = useCompany();
  const { t } = useI18n();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);
  const [lastSaveTick, setLastSaveTick] = useState(0); // forces re-render after save
  const [helpOpen, setHelpOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

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
      const res = await writeLocalMirror(activeCompanyId, activeMembership.companies.name, partyCode);
      if (res.fallbackReason) {
        toast.warning("Backup folder unavailable — saved to default location", {
          description: `${res.attemptedFolder ?? "your chosen folder"} could not be reached (${res.fallbackReason}). Pick a new folder in Administration → Backup & Restore.`,
          duration: 10000,
        });
      }
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

  // Run one-time desktop data migrations + daily safety snapshot in the
  // background. The workspace chrome must paint and accept keyboard input
  // immediately; none of these maintenance jobs is required to navigate it.
  useEffect(() => {
    let cancelled = false;
    setBootstrapping(false);
    (async () => {
      try {
        // Record version transition + detect unexpectedly-empty DB. Runs on
        // every launch, on every platform.
        try {
          const { checkUpdateSafety } = await import("@/lib/update-safety");
          await checkUpdateSafety();
        } catch { /* silent — never block boot on the safety check */ }

        if (isDesktopRuntime()) {
          void runAppDataMigrationsOnce().catch(() => undefined);
          if (memberships.length > 0) {
            const list = memberships
              .map((m) => ({ id: m.company_id, name: m.companies?.name ?? "company" }))
              .filter((c) => c.id);

            // 1) Silent auto-restore FIRST — if the live DB is empty but
            //    a valid snapshot exists on disk, put the data back before
            //    the UI renders. Toast the outcome; never prompt.
            try {
              const { runAutoRestore } = await import("@/lib/auto-restore");
              const outcomes = await runAutoRestore(list);
              const restored = outcomes.filter((o) => o.status === "restored");
              if (restored.length > 0) {
                // Providers mount outside this maintenance effect, so refresh
                // their in-memory views after IndexedDB has been replaced.
                // Without this, the disk restore succeeded but reports could
                // continue showing the pre-restore rows until app restart.
                window.dispatchEvent(new CustomEvent("ym:local-data-restored"));
                toast.success(
                  restored.length === 1
                    ? `Restored ${restored[0].companyName} from local safety snapshot`
                    : `Restored ${restored.length} companies from local safety snapshots`,
                  { description: "Your books were reloaded automatically from your on-device backup." },
                );
                // Remount the entire accounting workspace once so every
                // report and book sees the restored IndexedDB state, including
                // screens that loaded before recovery finished and do not use
                // the shared masters/balance caches. The next boot is a no-op
                // because the live counts now match the integrity manifest.
                window.setTimeout(() => window.location.reload(), 500);
              }
            } catch { /* silent — banner remains as fallback */ }

            // 2) Then take today's snapshot (respects the "never overwrite
            //    a good file with an empty one" rule inside auto-snapshot).
            const { runAutoSnapshotOnce } = await import("@/lib/auto-snapshot");
            void runAutoSnapshotOnce(list).catch(() => undefined);

            // If a new service worker is waiting to take over, snapshot
            // FIRST, then let it activate.
            if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
              try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg?.waiting) {
                  const { runPreUpdateSnapshot } = await import("@/lib/update-safety");
                  await runPreUpdateSnapshot(list);
                }
              } catch { /* ignore */ }
            }
          }
        }
      } finally { /* maintenance never gates first paint */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberships]);

  // No login screen any more — AuthProvider silently signs in a shared
  // tech user. We just wait for that to finish before rendering.


  // Staged Escape is now handled inside <GlobalShortcuts /> via useShortcut,
  // so this component no longer attaches its own window keydown listener.

  const onCompaniesPage = location.pathname.startsWith("/app/companies");

  // Startup focus: after the workspace mounts (company chosen + unlocked),
  // move focus to the first top-menu trigger so the user can immediately drive
  // the menubar with arrow keys — no initial Tab press required. We only do
  // this when focus is still on <body> (i.e. the user hasn't already clicked
  // or tabbed somewhere), so we never steal focus mid-interaction.
  useEffect(() => {
    if (bootstrapping || companyLoading) return;
    if (!activeCompanyId) return;
    if (onCompaniesPage) return;
    const id = window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.tagName !== "MAIN") return;
      const firstTrigger = document.querySelector<HTMLElement>(
        ".busy-topbar button.busy-menu",
      );
      firstTrigger?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [bootstrapping, companyLoading, activeCompanyId, onCompaniesPage]);

  // Gate: every page under /app requires a chosen + unlocked company
  // (except /app/companies, which is reachable when the user clicked "+ New company").
  // /app/assistant is intentionally NOT exempted — it can read accounting data.
  // Gate: every page under /app requires a chosen + unlocked company
  // (except /app/companies, which is reachable when the user clicked "+ New company").
  // /app/assistant is intentionally NOT exempted — it can read accounting data.
  //
  // NOTE: we intentionally do NOT block on `!user` (the silent Supabase
  // tech-session). Identity for this local-only app comes from the staff PIN
  // (already enforced by LockGate). Requiring `user` here caused the workspace
  // to hang on "Loading…" whenever the background tech sign-in stalled on a
  // slow / stagnant connection, forcing users to hard-refresh.
  useEffect(() => {
    if (bootstrapping || companyLoading) return;
    if (memberships.length === 0) return;
    if (onCompaniesPage) return;
    if (!activeCompanyId || !isCompanyUnlocked(activeCompanyId)) {
      import("@/lib/return-to").then(({ rememberReturnTo }) => {
        rememberReturnTo(location.pathname + (typeof window !== "undefined" ? window.location.search : ""));
      });
      navigate({ to: "/" });
    }
  }, [bootstrapping, companyLoading, memberships.length, activeCompanyId, onCompaniesPage, navigate]);

  // Read-only lock once the 30-day trial ends and no valid license is
  // installed: block voucher creation and the e-invoice screen; reports
  // remain fully readable (watermarked on export).
  useEffect(() => {
    const p = location.pathname;
    const isProtected = p.startsWith("/app/vouchers/new/") || p === "/app/einvoice";
    if (!isProtected) return;
    let cancelled = false;
    (async () => {
      const st = await getLicenseState();
      if (cancelled) return;
      if (isReadOnlyLocked(st)) {
        toast.error("Trial ended — enter a license key to keep creating vouchers.");
        navigate({ to: "/app/settings/license" });
      } else if (st.mode === "licensed" && st.plan === "basic" && p === "/app/einvoice") {
        toast.error("E-Invoice requires the Pro plan.");
        navigate({ to: "/app/settings/license" });
      }
    })();
    return () => { cancelled = true; };
  }, [location.pathname, navigate]);

  if (bootstrapping || companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // No companies yet → invite to create one (companies page still reachable).
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
          <Link to="/app/companies" search={{ new: 1 } as never}>Create company</Link>
        </Button>
      </div>
    );
  }

  const onLock = async () => {
    await lockWorkspace();
    navigate({ to: "/" });
  };

  const backupExtras = isTrial && lastSaveAt && !savingMirror ? (
    <span className="hidden text-[10px] text-muted-foreground md:inline" title={new Date(lastSaveAt).toLocaleString()}>
      Saved {new Date(lastSaveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  ) : null;

  return (
    <KeyboardProvider>
      <GlobalShortcuts onOpenHelp={() => setHelpOpen(true)} onOpenCalc={() => setCalcOpen(true)} />
      <div ref={workspaceRef} className="flex min-h-screen w-full flex-col">
        <TopMenuBar
          rightExtras={backupExtras}
          onLock={onLock}
          onBackupNow={isTrial ? onBackupNow : undefined}
          backupBusy={savingMirror}
          backupLabel={lastSaveAt ? `Backup now (last: ${new Date(lastSaveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "Backup now"}
        />
        <div className="flex items-center border-b border-border bg-background">
          <div className="flex-1 min-w-0"><QuickActionsRibbon /></div>
          <div className="flex items-center gap-2 px-2 self-stretch border-l border-border"><InstallAppButton /></div>
        </div>

        <UpdateRecoveryBanner />
        <BackupNudgeBanner />
        <AccountGroupsProvider>
          <MastersProvider>
            <BalancesProvider>
              <FocusHintsProvider>
                <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">
                  <Outlet />
                </main>
                <StatusBar onOpenHelp={() => setHelpOpen(true)} onOpenTray={() => setTrayOpen(true)} />
                <PendingSavesTray forceOpen={trayOpen} onClose={() => setTrayOpen(false)} />
              </FocusHintsProvider>
            </BalancesProvider>
          </MastersProvider>
        </AccountGroupsProvider>
        <KeyboardCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
        <CalculatorDialog open={calcOpen} onOpenChange={setCalcOpen} />
        <DataOwnershipDialog />
      </div>
    </KeyboardProvider>
  );
}

// -----------------------------------------------------------------------------
// Global shortcuts (mounted inside <KeyboardProvider>): F1 help, staged Escape,
// Alt+L ledger. Kept as a child so useShortcut can access the provider context.
//
// Note: Alt+<letter> voucher shortcuts used to live here but were removed —
// they conflicted with TopMenuBar's Alt+<letter> menu access keys (Alt+P for
// Print vs Purchase, Alt+R for Reports vs Receipt). The top menus already
// expose those voucher shortcuts via Transactions.
// -----------------------------------------------------------------------------


function GlobalShortcuts({ onOpenHelp, onOpenCalc }: { onOpenHelp: () => void; onOpenCalc: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  useShortcut(
    "F1",
    (e) => {
      e.preventDefault();
      onOpenHelp();
    },
    { scope: "global", allowInField: true, description: "Show keyboard shortcuts" },
  );

  useShortcut(
    "Ctrl+Alt+c",
    (e) => {
      e.preventDefault();
      onOpenCalc();
    },
    { scope: "global", allowInField: true, description: "Open calculator" },
  );

  // Staged Escape (single owner) — Busy/Tally-style "step down one level" ladder:
  //   1. Field focused (input/textarea/select/contentEditable) → blur it.
  //   2. Any Radix overlay open → let Radix close it (no-op here).
  //   3. Focus on top menubar (dropdown closed) → step DOWN to Quick Entry
  //      ribbon. TopMenuBar's Escape binding then only fires if the ribbon
  //      isn't present (auth screens, mobile), triggering exit-confirm.
  //   4. Focus on Quick Entry ribbon → step DOWN to main content.
  //   5. On a voucher entry route → back to the voucher list.
  //   6. Anywhere else → step UP to the menubar (so a lost user can always
  //      hit Esc to reach the menus, exactly like Busy).
  useShortcut(
    "Escape",
    (e) => {
      const target = e.target as HTMLElement | null;
      const openOverlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
      );
      if (openOverlay) return;
      const inField =
        !!target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (inField) {
        e.preventDefault();
        target?.blur?.();
        return;
      }
      // Menubar → let TopMenuBar's Escape binding fire (exit-confirm dialog).
      // Use F6 / Ctrl+F2 to hop menu→ribbon; Escape must exit, not sidestep.
      if (target?.closest?.(".busy-topbar")) {
        return;
      }
      // Ribbon → Menubar (so the very next Escape triggers exit-confirm).
      if (target?.closest?.(".busy-menubar")) {
        const firstTrigger = document.querySelector<HTMLElement>(
          ".busy-topbar button.busy-menu",
        );
        if (firstTrigger) {
          e.preventDefault();
          firstTrigger.focus();
          return;
        }
      }
      // Voucher entry → back to list
      if (location.pathname.startsWith("/app/vouchers/new/")) {
        e.preventDefault();
        navigate({ to: "/app/vouchers" });
        return;
      }
      // Main → Menubar (loop back to the top)
      const firstTrigger = document.querySelector<HTMLElement>(
        ".busy-topbar button.busy-menu",
      );
      if (firstTrigger) {
        e.preventDefault();
        firstTrigger.focus();
      }
    },
    { scope: "global", allowInField: true, description: "Escape / step down (menu→ribbon→main)" },
  );

  useShortcut(
    "Alt+l",
    (e) => {
      e.preventDefault();
      try {
        sessionStorage.setItem("ledgerReturnTo", location.pathname);
      } catch { /* ignore */ }
      navigate({ to: "/app/reports/ledger" });
    },
    { scope: "global", description: "Jump to Ledger report" },
  );

  // ---------------------------------------------------------------------------
  // Region cycler (Tally/Busy-style). F6 = next region, Shift+F6 = previous.
  // Regions in order: Top menubar → Quick Entry ribbon → Main content.
  // Report screens push their own "report" F6 handler that cycles toolbar↔grid
  // and takes precedence, so this global binding only fires elsewhere.
  //
  // Ctrl+F1 / Ctrl+F2 are direct jumps for muscle memory (menubar / ribbon).
  // These make it possible to hop between panes without ever pressing Tab.
  // ---------------------------------------------------------------------------
  const focusRegion = useCallback((region: "menu" | "ribbon" | "main") => {
    if (region === "menu") {
      const el = document.querySelector<HTMLElement>(".busy-topbar button.busy-menu");
      el?.focus();
      return !!el;
    }
    if (region === "ribbon") {
      // Prefer the first ribbon action; fall back to the ribbon's toggle button.
      const el =
        document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"][role="button"]') ??
        document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"]');
      el?.focus();
      return !!el;
    }
    // Main content: first focusable inside <main>.
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return false;
    const focusable = main.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? main).focus();
    return true;
  }, []);

  const currentRegion = useCallback((): "menu" | "ribbon" | "main" => {
    const a = document.activeElement as HTMLElement | null;
    if (a?.closest(".busy-topbar")) return "menu";
    if (a?.closest(".busy-menubar")) return "ribbon";
    return "main";
  }, []);

  useShortcut("F6", (e) => {
    e.preventDefault();
    const order: Array<"menu" | "ribbon" | "main"> = ["menu", "ribbon", "main"];
    const idx = order.indexOf(currentRegion());
    for (let i = 1; i <= order.length; i++) {
      if (focusRegion(order[(idx + i) % order.length])) return;
    }
  }, { scope: "global", allowInField: true, description: "Cycle region (menu → ribbon → main)" });

  useShortcut("Shift+F6", (e) => {
    e.preventDefault();
    const order: Array<"menu" | "ribbon" | "main"> = ["menu", "ribbon", "main"];
    const idx = order.indexOf(currentRegion());
    for (let i = 1; i <= order.length; i++) {
      if (focusRegion(order[(idx - i + order.length) % order.length])) return;
    }
  }, { scope: "global", allowInField: true, description: "Cycle region (reverse)" });

  useShortcut("Ctrl+F1", (e) => { e.preventDefault(); focusRegion("menu"); },
    { scope: "global", allowInField: true, description: "Jump to top menu" });
  useShortcut("Ctrl+F2", (e) => { e.preventDefault(); focusRegion("ribbon"); },
    { scope: "global", allowInField: true, description: "Jump to Quick Entry ribbon" });

  // Quick Entry ribbon Alt+<letter> shortcuts. Menu access keys for Reports
  // and Print were moved to Alt+E / Alt+N (see TopMenuBar) to free Alt+R and
  // Alt+P for Receipt and Purchase — matching the ribbon hints the user sees.
  const RIBBON_SHORTCUTS: Array<{ combo: string; to: string; desc: string }> = [
    { combo: "Alt+s", to: "/app/vouchers/new/sales", desc: "New Sales voucher" },
    { combo: "Alt+p", to: "/app/vouchers/new/purchase", desc: "New Purchase voucher" },
    { combo: "Alt+r", to: "/app/vouchers/new/receipt", desc: "New Receipt voucher" },
    { combo: "Alt+y", to: "/app/vouchers/new/payment", desc: "New Payment voucher" },
    { combo: "Alt+c", to: "/app/vouchers/new/credit_note", desc: "New Credit Note" },
    { combo: "Alt+d", to: "/app/vouchers/new/debit_note", desc: "New Debit Note" },
    { combo: "Alt+j", to: "/app/vouchers/new/journal", desc: "New Journal voucher" },
  ];
  for (const s of RIBBON_SHORTCUTS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(
      s.combo,
      (e) => {
        e.preventDefault();
        navigate({ to: s.to });
      },
      { scope: "global", allowInField: true, description: s.desc },
    );
  }




  return null;
}




