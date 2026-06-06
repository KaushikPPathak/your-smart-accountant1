import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { markUnlocked, type StaffRole } from "@/lib/staff-session";
import { ensureTechSession } from "@/lib/tech-user";
import { cacheAccountCredsFromCloud, verifyOfflineLogin } from "@/lib/offline/creds-cache";
import { isOnlineNow, pingOnline } from "@/lib/offline/online-status";

export const Route = createFileRoute("/lock")({
  head: () => ({ meta: [{ title: "Sign in — Smart Accountant" }] }),
  component: LockScreen,
});

function LockScreen() {
  const navigate = useNavigate();
  const [bootLoading, setBootLoading] = useState(true);
  const [accountsExist, setAccountsExist] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");

  // Login fields
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  // Signup fields
  const [suName, setSuName] = useState("");
  const [suUser, setSuUser] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suPass2, setSuPass2] = useState("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!isOnlineNow()) {
          setAccountsExist(true);
          setTab("login");
          return;
        }
        
        await Promise.race([
          ensureTechSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);

        const { data, error } = await supabase.rpc("accounts_exist");
        if (error) throw error;
        const exists = Boolean(data);
        setAccountsExist(exists);
        setTab(exists ? "login" : "signup");
      } catch {
        setAccountsExist(true);
        setTab("login");
      } finally {
        setBootLoading(false);
      }
    })();
  }, []);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass) {
      toast.error("Enter your username and password");
      return;
    }
    setBusy(true);
    try {
      const tryCloud = isOnlineNow();
      if (tryCloud) {
        try {
          // 1. Authenticate with cloud
          const { data, error } = await supabase.rpc("verify_account_login", {
            _username: loginUser.trim(),
            _password: loginPass,
          });
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          if (!row?.id) {
            toast.error("Invalid username or password");
            return;
          }
          
          console.log("✅ Online login success for user:", row.name, `(${loginUser.trim()})`);

          // Cache login details for offline checking later (Dexie + native SQLite)
          void cacheAccountCredsFromCloud(loginUser.trim(), loginPass);

          // Cache companies list for offline access using the picker view
          try {
            const { data: cloudCompanies } = await supabase
              .from("companies_picker")
              .select("id, name, has_password");
            if (cloudCompanies && cloudCompanies.length > 0) {
              const { offlineDb } = await import("@/lib/offline/db");
              const rows = cloudCompanies.map((c) => ({
                id: c.id as string,
                name: c.name as string,
                has_password: Boolean(c.has_password),
                account_id: row.id as string,
              }));
              await offlineDb.companies.bulkPut(rows);
            }
          } catch (syncErr) {
            console.error("Company cache sync skipped:", syncErr);
          }

          markUnlocked({ id: row.id, name: row.name, role: row.role as StaffRole });
          toast.success(`Welcome, ${row.name}`);
          navigate({ to: "/app" });
          return;
        } catch (cloudErr) {
          const reachable = await pingOnline();
          if (reachable) throw cloudErr;
        }
      }

      // Fall back to completely offline database checking
      const local = await verifyOfflineLogin(loginUser.trim(), loginPass);
      if (local) {
        markUnlocked({ id: local.id, name: local.name, role: local.role as StaffRole });
        toast.success(`Welcome, ${local.name} (offline)`);
        navigate({ to: "/app" });
        return;
      }

      toast.error("Invalid username or password");
    } catch (e) {
      console.error("Login failed:", e);
      const msg =
        (e as { message?: string; details?: string })?.message ||
        (e as { details?: string })?.details ||
        (typeof e === "string" ? e : null) ||
        "Login failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suName.trim()) return toast.error("Name is required");
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(suUser.trim()))
      return toast.error("Username must be 3–40 chars");
    if (suPass.length < 6) return toast.error("Password must be at least 6 characters");
    if (suPass !== suPass2) return toast.error("Passwords do not match");

    setBusy(true);
    try {
      const reachable = await pingOnline();
      if (!reachable) {
        toast.error("Sign-up needs an internet connection the first time.");
        return;
      }

      const rpc = accountsExist ? "signup_account" : "setup_first_account";
      const { data: newId, error } = await supabase.rpc(rpc, {
        _name: suName.trim(),
        _username: suUser.trim(),
        _password: suPass,
      });

      if (error) throw error;

      toast.success("Account created successfully!");
      markUnlocked({
        id: newId as string,
        name: suName.trim(),
        role: "admin",
      });
      navigate({ to: "/app" });
    } catch (e) {
      console.error("Signup failed:", e);
      const msg =
        (e as { message?: string; details?: string; hint?: string })?.message ||
        (e as { details?: string })?.details ||
        (typeof e === "string" ? e : null) ||
        "Signup failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Smart Accountant</h1>
            <p className="text-xs text-muted-foreground">Sign in to manage your books</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" disabled={!accountsExist}>
              <LogIn className="mr-2 h-4 w-4" /> Log in
            </TabsTrigger>
            <TabsTrigger value="signup">
              <UserPlus className="mr-2 h-4 w-4" /> Sign up
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={onLogin} className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-user">User ID</Label>
                <Input
                  id="login-user"
                  autoComplete="username"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-pass">Password</Label>
                <Input
                  id="login-pass"
                  type="password"
                  autoComplete="current-password"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Log in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={onSignup} className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="su-name">Your name</Label>
                <Input id="su-name" value={suName} onChange={(e) => setSuName(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-user">User ID</Label>
                <Input id="su-user" value={suUser} onChange={(e) => setSuUser(e.target.value)} disabled={busy} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass">Password</Label>
                  <Input id="su-pass" type="password" value={suPass} onChange={(e) => setSuPass(e.target.value)} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass2">Confirm</Label>
                  <Input id="su-pass2" type="password" value={suPass2} onChange={(e) => setSuPass2(e.target.value)} disabled={busy} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Sign up
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
