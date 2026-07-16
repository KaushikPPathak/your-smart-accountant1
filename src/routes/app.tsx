import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { PendingSavesTray } from "@/components/fast-form/PendingSavesTray";
import { FocusHintsProvider } from "@/components/fast-form/FocusHints";
import { StatusBar } from "@/components/fast-form/StatusBar";
import { BackupNudgeBanner } from "@/components/BackupNudgeBanner";
import { DataOwnershipDialog } from "@/components/DataOwnershipDialog";
import { UpdateRecoveryBanner } from "@/components/UpdateRecoveryBanner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { KeyboardProvider, useShortcut } from "@/lib/keyboard";

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

  // Run one-time desktop data migrations + daily safety snapshot (safe no-op on web).
  useEffect(() => {
    let cancelled = false;
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
                toast.success(
                  restored.length === 1
                    ? `Restored ${restored[0].companyName} from local safety snapshot`
                    : `Restored ${restored.length} companies from local safety snapshots`,
                  { description: "Your books were reloaded automatically from your on-device backup." },
                );
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
      // Stage-based Escape:
      //  1. Inside a form field → blur the field (so a second Esc escalates).
      //  2. Inside an open dialog/dropdown → let Radix/native close it.
      //  3. On a voucher entry page → back to vouchers list.
      //  4. Elsewhere in the app → move focus to the top menu.
      //  5. On the top menu → TopMenuBar handler shows the exit confirmation.
      if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const inField =
          !!target &&
          (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
        const openOverlay = document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
        );
        // Stage 2: let overlays close themselves
        if (openOverlay) return;
        // Stage 1: blur field first
        if (inField) {
          e.preventDefault();
          target?.blur?.();
          return;
        }
        // Stage 5 pre-check: if focus is already on the top menu, let
        // TopMenuBar's own handler show the exit confirmation.
        const onMenubar = target?.closest?.(".busy-topbar");
        if (onMenubar) return;
        // Stage 3: voucher entry → back to list
        if (location.pathname.startsWith("/app/vouchers/new/")) {
          e.preventDefault();
          navigate({ to: "/app/vouchers" });
          return;
        }
        // Stage 4: not on menubar → focus the first top-menu trigger
        const firstTrigger = document.querySelector<HTMLElement>(
          ".busy-topbar button.busy-menu",
        );
        if (firstTrigger) {
          e.preventDefault();
          firstTrigger.focus();
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
      <div className="flex min-h-screen w-full flex-col">
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
            <FocusHintsProvider>
              <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">
                <Outlet />
              </main>
              <StatusBar onOpenHelp={() => setHelpOpen(true)} onOpenTray={() => setTrayOpen(true)} />
              <PendingSavesTray forceOpen={trayOpen} onClose={() => setTrayOpen(false)} />
            </FocusHintsProvider>

          </MastersProvider>
        </AccountGroupsProvider>
        <KeyboardCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
        <DataOwnershipDialog />
      </div>
    </KeyboardProvider>
  );
}


