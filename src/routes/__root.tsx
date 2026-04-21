import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth-context";
import { CompanyProvider } from "@/lib/company-context";
import { ThemeProvider } from "@/lib/theme-context";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Your Mehtaji — Modern Accounting for India" },
      {
        name: "description",
        content:
          "GST-ready accounting software for Indian businesses. Multi-company, multi-user, with sales, purchase, inventory and reports. Inspired by Busy.",
      },
      { name: "author", content: "Your Mehtaji" },
      { property: "og:title", content: "Your Mehtaji — Modern Accounting for India" },
      {
        property: "og:description",
        content:
          "GST-ready accounting with sales, purchase, inventory, ledgers, P&L, balance sheet and GSTR reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Your Mehtaji — Modern Accounting for India" },
      { name: "description", content: "My Account Buddy is a Windows accounting application for Indian GST compliance." },
      { property: "og:description", content: "My Account Buddy is a Windows accounting application for Indian GST compliance." },
      { name: "twitter:description", content: "My Account Buddy is a Windows accounting application for Indian GST compliance." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c7be5486-6db1-443d-902b-6fc08e87090e/id-preview-c14a3a81--79fe3a99-5544-40be-ab1a-394be360a791.lovable.app-1776782467831.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c7be5486-6db1-443d-902b-6fc08e87090e/id-preview-c14a3a81--79fe3a99-5544-40be-ab1a-394be360a791.lovable.app-1776782467831.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CompanyProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </CompanyProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
