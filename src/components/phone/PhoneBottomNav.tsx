import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { BookText, Home, Menu, Package, ReceiptText, Landmark, Building2, Settings, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const MAIN = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/vouchers", label: "Vouchers", icon: ReceiptText, exact: false },
  { to: "/app/reports", label: "Reports", icon: BookText, exact: false },
  { to: "/app/ledgers", label: "Ledgers", icon: Users, exact: false },
] as const;

const MORE = [
  { to: "/app/items", label: "Items & stock", icon: Package },
  { to: "/app/bank", label: "Bank", icon: Landmark },
  { to: "/app/companies", label: "Companies", icon: Building2 },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

/** Phone-only bottom bar: one tap to the main areas. Hidden from `sm` up. */
export function PhoneBottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (to: string, exact: boolean) => (exact ? pathname === to : pathname === to || pathname.startsWith(to + "/"));

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="grid grid-cols-5">
          {MAIN.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.to, t.exact);
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <Menu className="h-5 w-5" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Other sections of your books.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {MORE.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-[72px] items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm font-medium"
                >
                  <Icon className="h-5 w-5 text-primary" />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
