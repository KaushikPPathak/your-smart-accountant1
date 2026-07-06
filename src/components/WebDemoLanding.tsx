// Web-only landing page. Shown in the browser build of Your Mehtaji, where
// the accounting workspace is intentionally disabled. Financial data lives
// on the user's device in the Windows desktop app — the web build is a
// demo/marketing surface only.

import { Download, ShieldCheck, HardDrive, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES: { icon: React.ReactNode; title: string; desc: string }[] = [
  {
    icon: <HardDrive className="h-5 w-5" />,
    title: "100% on your device",
    desc: "Books, vouchers, ledgers and reports live in local storage on your PC. Nothing is shipped to any server.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Automatic silent backups",
    desc: "Daily snapshots to a folder you control, plus automatic recovery if the database is ever unexpectedly empty.",
  },
  {
    icon: <Building2 className="h-5 w-5" />,
    title: "Full Indian accounting",
    desc: "GST-ready invoicing, inventory, e-invoice, GSTR-1/2B/3B, tax audit, financial year lock — everything offline.",
  },
];

export function WebDemoLanding() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 520px at 15% -10%, hsl(245 90% 62% / 0.20), transparent 60%)," +
            "radial-gradient(900px 480px at 100% 110%, hsl(330 90% 60% / 0.18), transparent 60%)",
        }}
      />

      <header className="border-b border-border/60 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground text-lg font-bold shadow"
              style={{ background: "linear-gradient(135deg, hsl(245 80% 60%), hsl(330 85% 58%))" }}
            >
              म
            </div>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Your Mehtaji</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Smart Accountant · Desktop
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
          Windows Desktop App
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your books belong on your desk — not on a server.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          Your Mehtaji is a fully offline accounting suite for India. To keep your
          financial data completely under your control, the accounting workspace
          runs only inside the Windows desktop application. This web page is a
          preview — no company data can be opened here.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="gap-2" disabled title="Ask us for the installer">
            <Download className="h-4 w-4" /> Download for Windows
          </Button>
          <a
            href="mailto:acauntant@gmail.com?subject=Your%20Mehtaji%20desktop%20installer"
            className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
          >
            Request installer by email
          </a>
        </div>

        <div className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border/60 bg-card/70 p-5 backdrop-blur"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {f.icon}
              </div>
              <div className="mt-3 text-sm font-semibold">{f.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji · Desktop-only accounting for India
      </footer>
    </div>
  );
}
