import { Outlet, Link, createRootRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CompanyProvider } from "@/lib/company-context";
import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { DateFormatProvider } from "@/lib/date-format";
import { Toaster } from "@/components/ui/sonner";
import { ExportShowcase } from "@/components/export/ExportShowcase";
import { isUnlocked } from "@/lib/staff-session";
import { BrainProvider } from "@/brain/BrainProvider";
import { isDesktopRuntime } from "@/lib/native-bridge";
import { WebDemoLanding } from "@/components/WebDemoLanding";
import { installCrashHandlers } from "@/lib/crash-log";

// Layer 5 — install global crash + rejection handlers once at module load
// (browser only; no-op on SSR). Failures land in a bounded local ring buffer.
installCrashHandlers();

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
                  <WebGate>
                    <LockGate>
                      <Outlet />
                    </LockGate>
                  </WebGate>
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
  if (!isDesktop) return <WebDemoLanding />;
  return <>{children}</>;
}

// Routes reachable without unlocking — the offline diagnostic assistant is
// intentionally exempt so users can troubleshoot sign-in / sync issues before
// they get past the lock screen. `/welcome` is the local-first first-launch
// landing so it must also bypass the lock gate.
const LOCK_EXEMPT_PATHS = new Set(["/lock", "/assistant", "/welcome"]);

function LockGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (LOCK_EXEMPT_PATHS.has(location.pathname)) return;
    if (isUnlocked()) return;

    // Local-first: if the user already onboarded in local mode, silently
    // re-establish the hidden device profile and continue — never bounce
    // them to the sign-in screen.
    void (async () => {
      try {
        const { hasLocalDeviceProfile, ensureLocalDeviceProfile } = await import(
          "@/lib/local-device-profile"
        );
        if (hasLocalDeviceProfile()) {
          try { ensureLocalDeviceProfile(); } catch { /* ignore */ }
          return;
        }
        // Returning cloud-account user? Send them to /lock so they can
        // log in. Otherwise show the local-first welcome screen.
        try {
          const { listCachedAccounts } = await import("@/lib/offline/creds-cache");
          const cached = await listCachedAccounts();
          if (cached && cached.length > 0) {
            navigate({ to: "/lock" });
            return;
          }
        } catch { /* ignore */ }
        navigate({ to: "/welcome" });
      } catch (err) {
        // Last-ditch fallback: never leave the user stuck on a blank screen.
        console.warn("LockGate boot failed, falling back to /welcome:", err);
        try { navigate({ to: "/welcome" }); } catch { /* ignore */ }
      }
    })();
  }, [loading, location.pathname, navigate]);

  return <>{children}</>;
}
