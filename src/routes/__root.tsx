import { Outlet, Link, createRootRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CompanyProvider } from "@/lib/company-context";
import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { DateFormatProvider } from "@/lib/date-format";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExportShowcase } from "@/components/export/ExportShowcase";
import { isUnlocked } from "@/lib/staff-session";
import { BrainProvider } from "@/brain/BrainProvider";
import { isDesktopRuntime } from "@/lib/native-bridge";
import { WebDemoLanding } from "@/components/WebDemoLanding";
import { OfflineBanner } from "@/components/OfflineBanner";

import { installCrashHandlers } from "@/lib/crash-log";
import { installErrorRing } from "@/lib/ai/error-ring";
import { installNativeDialogShim } from "@/lib/native-dialog-shim";

// Neutralise Tauri's window.alert/confirm/prompt override before any code
// path (auth boot, restore banner, voucher discard guards) can trip its ACL.
installNativeDialogShim();
// Layer 5 — install global crash + rejection handlers once at module load
// (browser only; no-op on SSR). Failures land in a bounded local ring buffer.
installCrashHandlers();
// AI diagnostic ring — mirrors console.error / window errors for the assistant.
installErrorRing();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <CurrencyProvider>
          <DateFormatProvider>
            <AuthProvider>
              <CompanyProvider>
                <BrainProvider>
                  <TooltipProvider delayDuration={200}>
                    <OfflineBanner />
                    <WebGate>
                      <LockGate>
                        <Outlet />
                      </LockGate>
                    </WebGate>
                  </TooltipProvider>

                </BrainProvider>
                <Toaster richColors position="top-right" />
                <ExportShowcase />
              </CompanyProvider>
            </AuthProvider>
          </DateFormatProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Web-runtime gate. The shipping product is the Windows desktop (Tauri) build;
 * the browser build MUST NOT expose the accounting workspace, financial data,
 * or the offline assistant. On the web, always render the demo landing —
 * regardless of URL — so no /app/* route can be opened.
 */
function WebGate({ children }: { children: React.ReactNode }) {
  // useState so runtime detection is stable across renders and we render the
  // same tree on first paint (avoids a flash of the workspace shell).
  const [isDesktop] = useState<boolean>(() => isDesktopRuntime());
  const location = useLocation();
  // Legal pages stay publicly reachable on the web build so store reviewers
  // and users can read the privacy policy without installing anything.
  if (PUBLIC_PATHS.has(location.pathname)) return <>{children}</>;
  if (!isDesktop) return <WebDemoLanding />;
  return <>{children}</>;
}

// Publicly reachable routes (no desktop runtime, no unlock required).
const PUBLIC_PATHS = new Set(["/privacy"]);


// Routes reachable without unlocking — the offline diagnostic assistant is
// intentionally exempt so users can troubleshoot sign-in / sync issues before
// they get past the lock screen. `/welcome` is the local-first first-launch
// landing so it must also bypass the lock gate.
const LOCK_EXEMPT_PATHS = new Set(["/lock", "/assistant", "/welcome", "/privacy"]);

function LockGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading } = useAuth();
  const [booting, setBooting] = useState(true);
  const discoveryDone = useRef(false);

  useEffect(() => {
    // Phase 1: Snapshot Discovery & Auto-Restore (Desktop only)
    if (!discoveryDone.current && isDesktopRuntime()) {
      discoveryDone.current = true;
      void (async () => {
        try {
          const [{ discoverCompaniesFromSnapshots }, { offlineDb }, { runAutoRestore }, { checkUpdateSafety }, { dedupeLocalCompaniesOnce }] = await Promise.all([
            import("@/lib/offline/snapshot-discovery"),
            import("@/lib/offline/db"),
            import("@/lib/auto-restore"),
            import("@/lib/update-safety"),
            import("@/lib/dedupe-local-companies"),
          ]);


          // 1. Scan for orphans/missing companies from disk snapshots first
          const discoveredCount = await discoverCompaniesFromSnapshots();
          
          // 2. Load the current (potentially reconstructed) company list
          const companies = await offlineDb.companies.toArray();
          
          // 3. Trigger silent auto-restore for any company with missing data
          if (companies.length > 0) {
            await runAutoRestore(companies);
          }

          // 4. Update safety counters so the app doesn't think it's still "missing"
          await checkUpdateSafety();

          // 5. Safely dedupe only AFTER discovery and restore are done
          await dedupeLocalCompaniesOnce();

        } catch (err) {
          console.warn("Startup discovery/restore cycle failed:", err);
        } finally {
          setBooting(false);
        }
      })();
    } else if (!isDesktopRuntime()) {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    if (loading || booting) return;

    // Wait until booting (discovery/restore) is truly finished before deciding
    // whether to show the welcome screen or lock screen.
    if (booting) return;

    if (LOCK_EXEMPT_PATHS.has(location.pathname)) return;
    if (isUnlocked()) return;

    void (async () => {
      try {
        const { hasLocalDeviceProfile, ensureLocalDeviceProfile } = await import(
          "@/lib/local-device-profile"
        );
        
        // If we found companies during discovery, we should have a profile.
        if (hasLocalDeviceProfile()) {
          try { ensureLocalDeviceProfile(); } catch { /* ignore */ }
          return;
        }

        const { listCachedAccounts } = await import("@/lib/offline/creds-cache");
        const cached = await listCachedAccounts();
        if (cached && cached.length > 0) {
          navigate({ to: "/lock" });
          return;
        }
        
        navigate({ to: "/welcome" });
      } catch (err) {
        console.warn("LockGate transition failed, falling back to /welcome:", err);
        try { navigate({ to: "/welcome" }); } catch { /* ignore */ }
      }
    })();
  }, [loading, booting, location.pathname, navigate]);

  if (booting) return null; // Prevent UI flash during discovery


  return <>{children}</>;
}
