import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { markUnlocked, type StaffRole } from "@/lib/staff-session";
import { ensureTechSession } from "@/lib/tech-user";

export const Route = createFileRoute("/lock")({
  head: () => ({ meta: [{ title: "Unlock — Your Mehtaji" }] }),
  component: LockScreen,
});

interface StaffRow {
  id: string;
  name: string;
  role: StaffRole;
}

function LockScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [picked, setPicked] = useState<StaffRow | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  // First-run admin setup
  const [setupName, setSetupName] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupPin2, setSetupPin2] = useState("");

  useEffect(() => {
    (async () => {
      try {
        await ensureTechSession();
        const { data, error } = await supabase
          .from("app_users")
          .select("id, name, role")
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (error) throw error;
        setStaff((data ?? []) as StaffRow[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submitSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{4,6}$/.test(setupPin)) {
      toast.error("PIN must be 4–6 digits");
      return;
    }
    if (setupPin !== setupPin2) {
      toast.error("PINs do not match");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("setup_first_admin", {
        _name: setupName,
        _pin: setupPin,
      });
      if (error) throw error;
      markUnlocked({ id: data as string, name: setupName.trim(), role: "admin" });
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("verify_app_user_pin", {
        _user_id: picked.id,
        _pin: pin,
      });
      if (error) throw error;
      if (!data) {
        toast.error("Wrong PIN");
        setPin("");
        return;
      }
      markUnlocked(picked);
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 480px at 20% -10%, hsl(245 90% 62% / 0.18), transparent 60%)," +
            "radial-gradient(700px 420px at 100% 110%, hsl(330 90% 60% / 0.16), transparent 60%)",
        }}
      />

      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/90 p-8 shadow-elevated backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground text-lg font-bold shadow-card"
            style={{ background: "linear-gradient(135deg, hsl(245 80% 60%), hsl(330 85% 58%))" }}
          >
            म
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Your Mehtaji</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Workstation lock
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : staff.length === 0 ? (
          // First-run: create admin
          <form onSubmit={submitSetup} className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Create the first admin account to start using the app.</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sname">Your name</Label>
              <Input
                id="sname"
                autoFocus
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="spin">PIN (4–6 digits)</Label>
                <Input
                  id="spin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="spin2">Confirm PIN</Label>
                <Input
                  id="spin2"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={setupPin2}
                  onChange={(e) => setSetupPin2(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy || !setupName || !setupPin}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create admin & enter
            </Button>
          </form>
        ) : !picked ? (
          // Pick staff
          <div className="space-y-2">
            <div className="mb-1 text-sm text-muted-foreground">Who's using this PC?</div>
            {staff.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setPicked(s);
                  setPin("");
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/80 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold">
                  {s.name.trim()[0]?.toUpperCase() || <UserIcon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {s.role}
                  </div>
                </div>
                <span className="text-muted-foreground/60">→</span>
              </button>
            ))}
          </div>
        ) : (
          // Enter PIN
          <form onSubmit={submitPin} className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold">
                {picked.name.trim()[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{picked.name}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {picked.role}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicked(null);
                  setPin("");
                }}
              >
                Change
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || pin.length < 4}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Unlock
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
