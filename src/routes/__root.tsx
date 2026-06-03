import { Outlet, Link, createRootRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CompanyProvider } from "@/lib/company-context";
import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { DateFormatProvider } from "@/lib/date-format";
import { Toaster } from "@/components/ui/sonner";
import { isUnlocked } from "@/lib/staff-session";
import { BrainProvider } from "@/brain/BrainProvider";
// 1. Import your dynamic migration function here
import { runAppDataMigrationsOnce } from "../lib/app-data-migrations"; 

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
            {/* 2. Wrap all application operations within the Migration Gate block */}
            <MigrationGate>
              <AuthProvider>
                <CompanyProvider>
                  <BrainProvider>
                    <LockGate>
                      <Outlet />
                    </LockGate>
                  </BrainProvider>
                  <Toaster richColors position="top-right" />
                </CompanyProvider>
              </AuthProvider>
            </MigrationGate>
          </DateFormatProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * 3. MigrationGate Component: 
 * Prevents initialization logic and subsequent page rendering 
 * until the database engine schemas match execution parameters.
 */
function MigrationGate({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  useEffect(() => {
    runAppDataMigrationsOnce()
      .then((res) => {
        if (res.error) {
          setMigrationError(res.error);
        } else {
          setIsReady(true);
        }
      })
      .catch((err) => {
        setMigrationError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (migrationError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <div className="max-w-md space-y-4 rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive-foreground">
          <h2 className="text-lg font-bold">Local Engine Database Error</h2>
          <p className="text-sm opacity-90">
            The application failed to safely prepare your local workspace files. 
          </p>
          <pre className="rounded bg-black/10 p-3 text-left font-mono text-xs overflow-x-auto">
            {migrationError}
          </pre>
          <p className="text-xs opacity-70">Please restart the desktop application or check your configuration.</p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background space-y-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground animate-pulse font-medium">
          Verifying storage directories & ledger tables...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function LockGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (location.pathname === "/lock") return;
    if (!isUnlocked()) navigate({ to: "/lock" });
  }, [loading, location.pathname, navigate]);

  return <>{children}</>;
}
