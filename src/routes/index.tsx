import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Lock, Plus, Unlock, LogOut as ExitIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureTechSession,
  isCompanyUnlocked,
  markCompanyUnlocked,
} from "@/lib/tech-user";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your Mehtaji — Open company" },
      { name: "description", content: "Pick a company to open." },
    ],
  }),
  component: StartScreen,
});

interface PickerCompany {
  id: string;
  name: string;
  has_password: boolean;
}

function StartScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<PickerCompany[]>([]);
  const [pendingCompany, setPendingCompany] = useState<PickerCompany | null>(null);
  const [pwd, setPwd] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await ensureTechSession();
        const { data, error } = await supabase
          .from("companies_picker")
          .select("id, name, has_password")
          .order("name", { ascending: true });
        if (error) throw error;
        setCompanies((data ?? []) as PickerCompany[]);
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Failed to load companies");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openCompany = async (c: PickerCompany) => {
    if (!c.has_password || isCompanyUnlocked(c.id)) {
      localStorage.setItem("ym_active_company_id", c.id);
      markCompanyUnlocked(c.id);
      navigate({ to: "/app" });
      return;
    }
    setPendingCompany(c);
    setPwd("");
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingCompany) return;
    setVerifying(true);
    try {
      const { data, error } = await supabase.rpc("verify_company_password", {
        _company_id: pendingCompany.id,
        _attempt: pwd,
      });
      if (error) throw error;
      if (!data) {
        toast.error("Wrong password");
        setPwd("");
        return;
      }
      markCompanyUnlocked(pendingCompany.id);
      localStorage.setItem("ym_active_company_id", pendingCompany.id);
      setPendingCompany(null);
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const newCompany = () => {
    // Pick a "blank slate" by clearing active id, then route into the workspace
    // which will land on /app/companies because there's no active selection.
    // If user has 0 companies, app.tsx already routes them to /app/companies.
    localStorage.removeItem("ym_active_company_id");
    // Mark a sentinel unlock so app.tsx doesn't bounce us back when there are no companies
    sessionStorage.setItem("ym_unlocked___create__", "1");
    navigate({ to: "/app/companies" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-brand text-primary-foreground font-bold text-lg shadow-elevated">
              म
            </div>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Your Mehtaji</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Open a company
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => window.close()} className="hidden md:inline-flex">
            <ExitIcon className="mr-2 h-4 w-4" /> Exit
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Select a company</h1>
            <p className="text-sm text-muted-foreground">
              Click a company to open it. Locked companies will ask for a password.
            </p>
          </div>
          <Button onClick={newCompany}>
            <Plus className="mr-2 h-4 w-4" /> New company
          </Button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No companies yet. Create your first one.</p>
            <Button onClick={newCompany}>
              <Plus className="mr-2 h-4 w-4" /> Create company
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => openCompany(c)}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-elevated"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.has_password ? (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5 text-success" />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.has_password ? "Password protected" : "No password — opens directly"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!pendingCompany} onOpenChange={(o) => !o && setPendingCompany(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Open “{pendingCompany?.name}”</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cpwd">Company password</Label>
              <Input
                id="cpwd"
                type="password"
                autoFocus
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Enter password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPendingCompany(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={verifying || !pwd}>
                {verifying ? "Checking…" : "Open"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji
      </footer>
    </div>
  );
}
