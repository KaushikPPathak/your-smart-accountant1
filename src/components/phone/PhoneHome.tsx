import { Link } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Landmark,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  Hourglass,
} from "lucide-react";

type Tile = { to: string; label: string; hint: string; icon: React.ElementType; tone: string };

// The few things a phone user does most: record a sale or payment, or open a report.
const TRANSACT: Tile[] = [
  { to: "/app/vouchers/new/sales", label: "Sales", hint: "New sales invoice", icon: ShoppingCart, tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  { to: "/app/vouchers/new/purchase", label: "Purchase", hint: "New purchase bill", icon: ShoppingBag, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  { to: "/app/vouchers/new/receipt", label: "Receipt", hint: "Money received", icon: ArrowDownToLine, tone: "bg-teal-500/15 text-teal-600 dark:text-teal-400" },
  { to: "/app/vouchers/new/payment", label: "Payment", hint: "Money paid", icon: ArrowUpFromLine, tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
];

const SEE: Tile[] = [
  { to: "/app/reports/receivables", label: "Receivables", hint: "Who owes you", icon: Hourglass, tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { to: "/app/reports/payables", label: "Payables", hint: "What you owe", icon: Wallet, tone: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  { to: "/app/reports/cash-bank", label: "Cash & Bank", hint: "Cash and bank book", icon: Landmark, tone: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  { to: "/app/reports/day-book", label: "Day Book", hint: "Today's entries", icon: BookOpen, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  { to: "/app/reports/profit-loss", label: "Profit & Loss", hint: "How the year is going", icon: ReceiptText, tone: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400" },
  { to: "/app/reports/balance-sheet", label: "Balance Sheet", hint: "Assets and liabilities", icon: BookOpen, tone: "bg-pink-500/15 text-pink-600 dark:text-pink-400" },
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className="flex min-h-[96px] flex-col justify-between rounded-2xl border border-border bg-card p-4 text-left shadow-sm active:scale-[0.98] transition-transform"
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.tone}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="mt-3">
              <span className="block text-base font-semibold leading-tight">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Phone-only home: big tap targets for transacting and opening reports. */
export function PhoneHome() {
  return (
    <section className="space-y-5 sm:hidden" aria-label="Quick actions">
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Record</h2>
        <TileGrid tiles={TRANSACT} />
      </div>
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reports</h2>
        <TileGrid tiles={SEE} />
        <Link to="/app/reports" className="mt-3 block text-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          All reports
        </Link>
      </div>
    </section>
  );
}
