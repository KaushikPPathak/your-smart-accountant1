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
import { RestoreInterruptedBanner } from "@/components/RestoreInterruptedBanner";
import { SilentWatchers } from "@/components/assistant/SilentWatchers";

import { getLicenseState, isReadOnlyLocked } from "@/lib/license/state";

// ADDED: Tauri v2 invoke for DevTools
import { invoke } from "@tauri-apps/api/core";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Your Mehtaji — Workspace" }] }),
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  useAuth();
  const { loading: companyLoading, memberships, activeCompanyId, activeMembership } = useCompany();
  const { t } = useI18n();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);
  const [lastSaveTick, setLastSaveTick] = useState(0);
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

  useEffect(() => {
    if (!isTrial || !activeCompanyId || !activeMembership) return;
    const handler = () => {
      try {
        toast.message("Saving local backup before close…", {
          description: `${activeMembership.companies.name}${partyCode ? ` · ${partyCode}` : ""}`,
          duration: 8000,
        });
      } catch { /* ignore */ }
      void writeLocalMirror(activeCompanyId, activeMembership.companies.name, partyCode).catch(() => undefined);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isTrial, activeCompanyId, activeMembership, partyCode]);

  useEffect(() => {
    let cancelled = false;
    let stopIntraday: (() => void) | null = null;
    setBootstrapping(false);
    (async () => {

      try {
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

            try {
              const { runAutoRestore } = await import("@/lib/auto-restore");
              const outcomes = await runAutoRestore(list);
              const restored = outcomes.filter((o) => o.status === "restored");
              if (restored.length > 0) {
                window.dispatchEvent(new CustomEvent("ym:local-data-restored"));
                toast.success(
                  restored.length === 1
                    ? `Restored ${restored[0].companyName} from local safety snapshot`
                    : `Restored ${restored.length} companies from local safety snapshots`,
                  { description: "Your books were reloaded automatically from your on-device backup." },
                );
                window.setTimeout(() => window.location.reload(), 500);
              }
            } catch { /* silent — banner remains as fallback */ }

            const { runAutoSnapshotOnce } = await import("@/lib/auto-snapshot");
            void runAutoSnapshotOnce(list).catch(() => undefined);

            try {
              const { scheduleIntradaySnapshots } = await import("@/lib/intraday-snapshot");
              stopIntraday = scheduleIntradaySnapshots(list);
            } catch { /* ignore — intraday is a bonus, never blocks boot */ }

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
      if (stopIntraday) { try { stopIntraday(); } catch { /* ignore */ } }
    };
  }, [memberships]);

  const onCompaniesPage = location.pathname.startsWith("/app/companies");

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

  // ADDED: Right-click context menu with Inspect Element
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Don't override native context menus inside inputs, textareas, or existing menus
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return;

      e.preventDefault();

      const existing = document.getElementById("tauri-debug-menu");
      if (existing) existing.remove();

      const menu = document.createElement("div");
      menu.id = "tauri-debug-menu";
      menu.style.cssText = `
        position:fixed; z-index:99999; background:#fff; border:1px solid #ccc;
        box-shadow:2px 2px 6px rgba(0,0,0,0.2); border-radius:4px; padding:4px 0;
        font-family:system-ui,sans-serif; font-size:13px; min-width:160px; color:#000;
      `;
      menu.style.left = e.clientX + "px";
      menu.style.top = e.clientY + "px";

      const items = [
        { label: "Inspect Element", action: () => invoke("toggle_devtools") },
        { label: "Reload", action: () => window.location.reload() },
      ];

      for (const item of items) {
        const div = document.createElement("div");
        div.textContent = item.label;
        div.style.cssText = "padding:6px 16px; cursor:pointer;";
        div.onmouseenter = () => (div.style.background = "#f0f0f0");
        div.onmouseleave = () => (div.style.background = "transparent");
        div.onclick = () => {
          item.action().catch(() => {});
          menu.remove();
        };
        menu.appendChild(div);
      }

      document.body.appendChild(menu);

      setTimeout(() => {
        document.addEventListener("click", function close() {
          menu.remove();
          document.removeEventListener("click", close);
        }, { once: true });
      }, 10);
    };

    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  if (bootstrapping || companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

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
        <RestoreInterruptedBanner />
        <SilentWatchers />
      </div>
    </KeyboardProvider>
  );
}

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

  // ADDED: F12 → Toggle DevTools
  useShortcut(
    "F12",
    (e) => {
      e.preventDefault();
      invoke("toggle_devtools").catch(() => {});
    },
    { scope: "global", allowInField: true, description: "Toggle Developer Tools" },
  );

  // ADDED: Ctrl+Shift+I → Toggle DevTools
  useShortcut(
    "Ctrl+Shift+i",
    (e) => {
      e.preventDefault();
      invoke("toggle_devtools").catch(() => {});
    },
    { scope: "global", allowInField: true, description: "Toggle Developer Tools" },
  );

  // ADDED: Ctrl+Shift+C → Toggle DevTools (inspect element cursor)
  useShortcut(
    "Ctrl+Shift+c",
    (e) => {
      e.preventDefault();
      invoke("toggle_devtools").catch(() => {});
    },
    { scope: "global", allowInField: true, description: "Toggle Developer Tools (inspect)" },
  );

  useShortcut(
    "Escape",
    (e) => {
      const target = e.target as HTMLElement | null;
      const openOverlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
      );
      if (openOverlay) return;
      if (
        target &&
        (!target.isConnected ||
          target.closest?.(
            '[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [data-radix-menu-content], [cmdk-root]',
          ))
      ) {
        return;
      }
      const inField =
        !!target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (inField) {
        e.preventDefault();
        target?.blur?.();
        return;
      }

      if (target?.closest?.(".busy-topbar")) {
        return;
      }
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
      if (location.pathname.startsWith("/app/vouchers/new/")) {
        e.preventDefault();
        navigate({ to: "/app/vouchers" });
        return;
      }
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("app:exit-request"));
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

  const focusRegion = useCallback((region: "menu" | "ribbon" | "main") => {
    if (region === "menu") {
      const el = document.querySelector<HTMLElement>(".busy-topbar button.busy-menu");
      el?.focus();
      return !!el;
    }
    if (region === "ribbon") {
      const el =
        document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"][role="button"]') ??
        document.querySelector<HTMLElement>('.busy-menubar [data-focus-item="true"]');
      el?.focus();
      return !!el;
    }
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

  useShortcut("Ctrl+Shift+d", (e) => { e.preventDefault(); navigate({ to: "/app/diagnostics" }); },
    { scope: "global", allowInField: true, description: "Open Diagnostics" });

  useShortcut("Alt+ArrowUp", (e) => {
    e.preventDefault();
    const here = currentRegion();
    if (here === "main") focusRegion("ribbon");
    else if (here === "ribbon") focusRegion("menu");
  }, { scope: "global", allowInField: true, description: "Region up (main→ribbon→menu)" });
  useShortcut("Alt+ArrowDown", (e) => {
    e.preventDefault();
    const here = currentRegion();
    if (here === "menu") focusRegion("ribbon");
    else if (here === "ribbon") focusRegion("main");
  }, { scope: "global", allowInField: true, description: "Region down (menu→ribbon→main)" });

  useShortcut("Alt+o", (e) => {
    e.preventDefault();
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-company-switcher-trigger="true"]',
    );
    if (!trigger) return;
    trigger.focus();
    if (trigger.getAttribute("aria-expanded") !== "true") {
      trigger.click();
    }
  }, { scope: "global", allowInField: true, description: "Open Company switcher" });

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
