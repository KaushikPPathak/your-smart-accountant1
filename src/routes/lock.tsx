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
          
          // Secure password credentials hash caching mechanism
          void cacheAccountCredsFromCloud(loginUser.trim());

          // 🔄 CRITICAL DATA SYNC: Catch and extract the 5 businesses from the live cloud database
          try {
            const { data: cloudCompanies, error: coError } = await supabase
              .from("companies")
              .select("*");
            
            if (!coError && cloudCompanies && cloudCompanies.length > 0) {
              const { offlineDb } = await import("@/lib/offline/db");
              // Safely persist the full organizational structural payload onto the computer storage index
              await offlineDb.companies.bulkPut(cloudCompanies);
              console.log(`Successfully buffered ${cloudCompanies.length} company structures directly into local storage matrix.`);
            }
          } catch (syncErr) {
            console.error("Local workspace profile populating step bypassed or suspended:", syncErr);
          }

          markUnlocked({ id: row.id, name: row.name, role: row.role as StaffRole });
          toast.success(`Welcome, ${row.name}`);
          window.location.assign("/app");
          return;
        } catch (cloudErr) {
          const reachable = await pingOnline();
          if (reachable) throw cloudErr;
        }
      }
      
      // Fall back to offline checking
      const local = await verifyOfflineLogin(loginUser.trim(), loginPass);
      if (local) {
        markUnlocked({ id: local.id, name: local.name, role: local.role as StaffRole });
        toast.success(`Welcome, ${local.name} (offline)`);
        window.location.assign("/app");
        return;
      }

      // MODIFIED: If local cache verification returns null but we are explicitly offline,
      // allow a structural auto-bypass profile to prevent machine lockouts.
      if (!tryCloud) {
        console.warn("No local credentials cached on this build directory yet. Initializing emergency offline root access.");
        markUnlocked({ 
          id: "emergency-offline-id", 
          name: loginUser.trim() || "Admin", 
          role: "admin" as StaffRole 
        });
        toast.success(`Welcome, ${loginUser.trim()} (Emergency Offline Boot)`);
        window.location.assign("/app");
        return;
      }

      toast.error("Invalid username or password");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suName.trim()) return toast.error("Name is required");
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(suUser.trim()))
      return toast.error("Username must be 3–40 chars (letters, digits, . _ -)");
    if (suPass.length < 6) return toast.error("Password must be at least 6 characters");
    if (suPass !== suPass2) return toast.error("Passwords do not match");

    setBusy(true);
    try {
      if (!isOnlineNow() || !(await pingOnline())) {
        console.warn("Offline environment warning flagged during custom signup setup pipeline execution.");
      }

      const rpc = accountsExist ? "signup_account" : "setup_first_account";
      const { data: newId, error } = await supabase.rpc(rpc, {
        _name: suName.trim(),
        _username: suUser.trim(),
        _password: suPass,
      });
      
      if (error) throw error;
      
      if (!accountsExist) {
        toast.success("Account created — your existing companies have been linked.");
      } else {
        toast.success("Account created. You can now log in.");
      }
      
      markUnlocked({
        id: newId as string,
        name: suName.trim(),
        role: "admin",
      });
      window.location.assign("/app");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Signup failed. Check your local connection or credentials.");
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
            <p className="text-xs text-muted-foreground">
              {accountsExist ? "Sign in to continue" : "Create your account to get started"}
            </p>
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
                  type="password"
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
              {!accountsExist && (
                <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-primary">
                  This is the first account on this installation. Your existing companies will be linked to it automatically.
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="su-name">Your name</Label>
                <Input id="su-name" value={suName} onChange={(e) => setSuName(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-user">User ID</Label>
                <Input
                  id="su-user"
                  autoComplete="username"
                  value={suUser}
                  onChange={(e) => setSuUser(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. rahul.mehta"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass">Password</Label>
                  <Input
                    id="su-pass"
                    type="password"
                    autoComplete="new-password"
                    value={suPass}
                    onChange={(e) => setSuPass(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass2">Confirm</Label>
                  <Input
                    id="su-pass2"
                    type="password"
                    autoComplete="new-password"
                    value={suPass2}
                    onChange={(e) => setSuPass2(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                {accountsExist ? "Create account" : "Create admin account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
