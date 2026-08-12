// First-launch, local-first welcome screen.
//
// The user is NOT asked to sign in or create an account. They can:
//   • Create a new company — spins up a hidden local device profile
//   • Open an existing company — only visible if local companies exist
//   • Restore a backup — opens the existing pre-company restore dialog
//   • Sign in — small secondary link at the bottom (goes to /lock)

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, FolderOpen, HardDriveDownload, LogIn, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureLocalDeviceProfile, hasLocalDeviceProfile } from "@/lib/local-device-profile";
import { RestoreFromFileDialog } from "@/components/RestoreFromFileDialog";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome — Smart Accountant" },
      { name: "description", content: "Get started with your books on this device." },
    ],
  }),
  component: WelcomeScreen,
});

function WelcomeScreen() {
  const navigate = useNavigate();
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@/lib/offline/db");
        const db = mod.default || mod.offlineDb;
        const [a, b] = await Promise.all([
          db.companies.count().catch(() => 0),
          db.cache_companies.count().catch(() => 0),
        ]);
        if (!cancelled) setExistingCount(Math.max(a as number, b as number));
      } catch {
        if (!cancelled) setExistingCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const safeEnsure = () => {
    try { ensureLocalDeviceProfile(); } catch (err) { console.warn("ensureLocalDeviceProfile failed:", err); }
  };

  const onCreateNew = () => {
    safeEnsure();
    navigate({ to: "/app/companies", search: { new: 1 } as never });
  };

  const onOpenExisting = () => {
    safeEnsure();
    navigate({ to: "/" });
  };

  const onSignIn = () => {
    navigate({ to: "/lock" });
  };

  const hasExisting = (existingCount ?? 0) > 0;
  const wasLocalBefore = hasLocalDeviceProfile();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 520px at 15% -10%, hsl(245 90% 62% / 0.20), transparent 60%)," +
            "radial-gradient(900px 480px at 100% 110%, hsl(330 90% 60% / 0.18), transparent 60%)," +
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 100%)",
        }}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-primary-foreground text-2xl font-bold shadow-elevated"
            style={{ background: "linear-gradient(135deg, hsl(245 80% 60%), hsl(330 85% 58%))" }}
          >
            म
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {wasLocalBefore ? "Welcome back" : "Welcome to Smart Accountant"}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Your books stay on this computer. No account needed to get started —
            you can connect one later for backup and multi-device sync.
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-2">
          {/* Primary — Create New Company */}
          <button
            onClick={onCreateNew}
            className="group sm:col-span-2 flex items-center gap-4 rounded-2xl border border-primary/40 bg-primary/5 p-5 text-left shadow-elevated transition-all hover:-translate-y-0.5 hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Plus className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold tracking-tight">Create New Company</div>
              <div className="text-xs text-muted-foreground">
                Start entering vouchers right away. Stored locally on this PC.
              </div>
            </div>
            <span className="text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary">→</span>
          </button>

          {/* Open Existing — only if local companies exist */}
          {hasExisting && (
            <button
              onClick={onOpenExisting}
              className="group flex items-center gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                <FolderOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold tracking-tight">Open Existing Company</div>
                <div className="text-[11px] text-muted-foreground">
                  {existingCount} on this device
                </div>
              </div>
            </button>
          )}

          {/* Restore Backup */}
          <button
            onClick={() => { safeEnsure(); setRestoreOpen(true); }}
            className={`group flex items-center gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 ${hasExisting ? "" : "sm:col-span-2"}`}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <HardDriveDownload className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold tracking-tight">Restore Backup</div>
              <div className="text-[11px] text-muted-foreground">
                Bring back a company from a `.json` backup file.
              </div>
            </div>
          </button>
        </div>

        <div className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          <span>Local mode is on. Nothing leaves this device.</span>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onSignIn}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            <LogIn className="h-3.5 w-3.5" />
            Already have an account? Sign in
          </button>
        </div>
      </main>

      <RestoreFromFileDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        memberships={[]}
        onDone={() => {
          setRestoreOpen(false);
          navigate({ to: "/" });
        }}
      />

      <footer className="pb-6 text-center text-[11px] text-muted-foreground/70">
        <Building2 className="inline h-3 w-3 mr-1 opacity-70" />
        You can connect a cloud account any time from Settings.
      </footer>
    </div>
  );
}
