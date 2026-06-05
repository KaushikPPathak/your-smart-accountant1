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
                  <LockGate>
                    <Outlet />
                  </LockGate>
                </BrainProvider>
                <Toaster richColors position="top-right" />
              </CompanyProvider>
            </AuthProvider>
          </DateFormatProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ThemeProvider>
  );
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
