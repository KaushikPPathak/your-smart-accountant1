import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Banknote,
  Bell,
  Building2,
  Calculator,
  CheckCircle2,
  Database,
  FileBarChart,
  FileSpreadsheet,
  Keyboard,
  Package,
  ReceiptText,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your Mehtaji — Modern GST Accounting for India" },
      {
        name: "description",
        content:
          "GST sales & purchase, e-invoice, e-way bill, inventory, ledgers, P&L, GSTR-1/3B, bank reconciliation. Multi-company, multi-user, keyboard-first. Web + Windows.",
      },
      { property: "og:title", content: "Your Mehtaji — Modern GST Accounting" },
      {
        property: "og:description",
        content: "Tally-style speed with a modern interface. Web + Windows desktop.",
      },
    ],
  }),
  component: Landing,
});

const modules: { icon: typeof ReceiptText; title: string; desc: string }[] = [
  { icon: ReceiptText, title: "GST Sales & Purchase", desc: "Auto CGST/SGST/IGST split, HSN, e-invoice / e-way bill ready." },
  { icon: Calculator, title: "Double-entry Vouchers", desc: "Receipt, payment, journal, contra, credit & debit notes." },
  { icon: Package, title: "Inventory & Stock", desc: "Items, opening stock, in/out movement and stock summary." },
  { icon: FileBarChart, title: "Reports", desc: "Day book, ledger, trial balance, P&L, balance sheet." },
  { icon: FileSpreadsheet, title: "GSTR-1 / 3B / 2B", desc: "Built-in reconciliation, JSON export, IFF for QRMP." },
  { icon: Banknote, title: "Bank Reconciliation", desc: "Import statement, auto-match, mark cleared." },
  { icon: Building2, title: "Multi-company", desc: "Switch between businesses in one click." },
  { icon: Users, title: "Roles & teams", desc: "Admin, accountant, viewer — invite your CA." },
  { icon: ScanLine, title: "E-Invoice (IRN)", desc: "Generate, sign, cancel — Setu GSP integration." },
  { icon: Truck, title: "E-Way Bill", desc: "Vehicle, distance, transporter — generated in seconds." },
  { icon: Wallet, title: "Receivables / Payables", desc: "Outstanding & ageing with one-click reminders." },
  { icon: RefreshCw, title: "Recurring invoices", desc: "Set & forget monthly billing for retainers." },
  { icon: Bell, title: "Payment reminders", desc: "WhatsApp / Email follow-ups for overdue bills." },
  { icon: Database, title: "Backup & Restore", desc: "Per-company JSON snapshots; auto-saves on desktop." },
  { icon: Keyboard, title: "Busy-style hotkeys", desc: "Alt+S, Alt+P, Ctrl+S — fast like the old days." },
  { icon: ShieldCheck, title: "Bank-grade security", desc: "Row-level security, encrypted credentials." },
];

const benefits = [
  "Save 6+ hours / week on data entry",
  "GST-compliant invoices out of the box",
  "Works on Windows desktop & in browser",
  "Your data, exportable any time",
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-brand text-primary-foreground font-bold text-lg shadow-elevated">
        म
      </div>
      <div className="leading-tight">
        <div className="text-base font-semibold tracking-tight">Your Mehtaji</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Accounting · GST · Inventory
        </div>
      </div>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            <a href="#features" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#preview" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Preview
            </a>
            <a href="#why" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Why us
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-gradient-brand">
              <Link to="/signup">
                Get started <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-hero">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:py-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-card">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            GST-ready · Multi-company · Web + Windows desktop
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Modern accounting for{" "}
            <span className="text-gradient-brand">Indian businesses</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Tally-style speed with a clean interface. Sales, purchase, inventory, ledgers, GSTR
            reports, e-invoice and bank reconciliation — all in one place.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-gradient-brand shadow-elevated">
              <Link to="/signup">
                Create free account <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <ul className="mx-auto mt-8 grid max-w-3xl gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Mock app preview */}
      <section id="preview" className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mx-auto overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
            {/* Window chrome */}
            <div className="flex items-center gap-2 border-b border-border bg-background/60 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning" />
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="ml-3 text-xs text-muted-foreground">Your Mehtaji — Dashboard</span>
            </div>
            <div className="grid md:grid-cols-[180px_1fr]">
              {/* Sidebar */}
              <aside className="hidden flex-col gap-1 border-r border-border bg-sidebar p-3 text-sidebar-foreground md:flex">
                {[
                  "Dashboard",
                  "Vouchers",
                  "Ledgers",
                  "Items",
                  "Reports",
                  "GST",
                  "Bank",
                  "Settings",
                ].map((s, i) => (
                  <div
                    key={s}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      i === 0
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80"
                    }`}
                  >
                    {s}
                  </div>
                ))}
              </aside>
              {/* Main */}
              <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { l: "Sales (MTD)", v: "₹ 8,42,500", c: "text-success" },
                    { l: "Purchases (MTD)", v: "₹ 3,18,200", c: "text-primary" },
                    { l: "Receivables", v: "₹ 2,10,750", c: "text-accent" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-lg border border-border bg-background p-4 shadow-card">
                      <div className="text-xs text-muted-foreground">{s.l}</div>
                      <div className={`mt-1 text-xl font-semibold ${s.c}`}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-background p-4 shadow-card">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">Recent vouchers</div>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      Live
                    </span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {[
                      ["INV-0241", "Acme Traders", "₹ 24,500", "Sales"],
                      ["PO-0033", "Sharma Exports", "₹ 1,18,000", "Purchase"],
                      ["RCT-0118", "Bharat Steel", "₹ 50,000", "Receipt"],
                      ["JV-0009", "Depreciation", "₹ 12,400", "Journal"],
                    ].map((r) => (
                      <div
                        key={r[0]}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/60"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-muted-foreground">{r[0]}</span>
                          <span>{r[1]}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="num text-foreground">{r[2]}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {r[3]}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Everything you need
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            One app for the whole accounts department
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Explore every module before you sign up. Built for accountants, billing staff, and
            business owners.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-brand text-primary-foreground shadow-elevated">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="border-y border-border bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Why Your Mehtaji
            </div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              Built for India. Loved by accountants.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Stop juggling spreadsheets, WhatsApp screenshots and old desktop software. Your
              Mehtaji combines GST compliance, inventory, and cloud-grade reliability — without
              giving up the speed of keyboard-driven entry.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Per-company data isolation with row-level security",
                "JSON backup & restore — your data is never locked in",
                "Windows installer + lifetime web access",
                "Free updates — new modules every month",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex gap-3">
              <Button asChild size="lg" className="bg-gradient-brand">
                <Link to="/signup">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">I already have an account</Link>
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-elevated">
            <div className="text-sm font-semibold">Sample GST invoice</div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between border-b border-border pb-2">
                <span>Acme Traders Pvt Ltd</span>
                <span className="font-mono text-xs text-muted-foreground">INV-0241</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Goods (HSN 8471)</span>
                <span className="num">₹ 20,000.00</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>CGST 9%</span>
                <span className="num">₹ 1,800.00</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>SGST 9%</span>
                <span className="num">₹ 1,800.00</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Total</span>
                <span className="num text-primary">₹ 23,600.00</span>
              </div>
              <div className="mt-3 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                IRN generated · QR signed by NIC · E-Way Bill #123456789012
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Ready to switch?</h2>
        <p className="mt-3 text-muted-foreground">
          Sign up free in 30 seconds. No credit card. Import your existing ledgers any time.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild size="lg" className="bg-gradient-brand shadow-elevated">
            <Link to="/signup">Create your free account</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji. Built with ♥ for Indian businesses.
      </footer>
    </div>
  );
}
