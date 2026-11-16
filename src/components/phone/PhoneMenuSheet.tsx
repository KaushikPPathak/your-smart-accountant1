import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Phone-only menu. The desktop menu bar carries every screen; on a phone only
 * the screens a bookkeeper uses day to day are listed here. Desktop never
 * renders this component's trigger (hidden from `sm` up).
 */
export const PHONE_MENU: Array<{ title: string; items: Array<{ to: string; label: string }> }> = [
  {
    title: "Entry",
    items: [
      { to: "/app/vouchers/new/sales", label: "New sales" },
      { to: "/app/vouchers/new/purchase", label: "New purchase" },
      { to: "/app/vouchers/new/receipt", label: "Receipt" },
      { to: "/app/vouchers/new/payment", label: "Payment" },
      { to: "/app/vouchers", label: "All vouchers" },
    ],
  },
  {
    title: "Books",
    items: [
      { to: "/app/ledgers", label: "Ledgers / parties" },
      { to: "/app/items", label: "Items & stock" },
      { to: "/app/bank", label: "Bank" },
      { to: "/app/reports/day-book", label: "Day book" },
      { to: "/app/reports/ledger", label: "Ledger statement" },
      { to: "/app/reports/trial-balance", label: "Trial balance" },
      { to: "/app/reports/profit-loss", label: "Profit & loss" },
      { to: "/app/reports/balance-sheet", label: "Balance sheet" },
      { to: "/app/reports/stock-summary", label: "Stock summary" },
    ],
  },
  {
    title: "GST",
    items: [
      { to: "/app/reports/gstr1", label: "GSTR-1 / 3B / 2B" },
      { to: "/app/reports/gst-sales-book", label: "GST sales book" },
      { to: "/app/reports/gst-purchase-book", label: "GST purchase book" },
    ],
  },
  {
    title: "More",
    items: [
      { to: "/app/housekeeping", label: "Accounting tools" },
      { to: "/app/companies", label: "Companies" },
      { to: "/app/settings", label: "Settings" },
    ],
  },
];

export function PhoneMenuSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="busy-menu sm:hidden inline-flex h-11 items-center gap-1.5 px-3 text-sm font-medium"
      >
        <Menu className="h-5 w-5" />
        Menu
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="flex h-[85dvh] flex-col rounded-t-2xl p-0">
          <SheetHeader className="border-b px-4 pb-3 pt-4 text-left">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>The screens you use most on the phone.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {PHONE_MENU.map((section) => (
              <div key={section.title} className="py-2">
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </div>
                {section.items.map((it) => (
                  <Link
                    key={it.to}
                    to={it.to}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center rounded-md px-3 text-base text-foreground active:bg-accent"
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
