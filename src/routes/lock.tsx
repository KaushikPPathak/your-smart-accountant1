import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, ShieldCheck, UserPlus, EyeOff, AlertCircle, RefreshCw, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { markUnlocked, getLastUsername, type StaffRole } from "@/lib/staff-session";
import { ensureTechSession } from "@/lib/tech-user";
import { cacheAccountCredsFromCloud, verifyOfflineLogin, listCachedAccounts } from "@/lib/offline/creds-cache";
import { isOnlineNow, pingOnline } from "@/lib/offline/online-status";
import { consumeReturnTo } from "@/lib/return-to";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

export const Route = createFileRoute("/lock")({
  head: () => ({ meta: [{ title: "Sign in — Smart Accountant" }] }),
  component: LockScreen,
});

interface LoginUserOption {
  id: string;
  name: string;
  username: string;
  role: string;
}

const TYPE_MANUALLY = "__type_manually__";

const withTimeout = <T,>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

function LockScreen() {
  const navigate = useNavigate();
  const [bootLoading, setBootLoading] = useState(true);
  const [accountsExist, setAccountsExist] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Login fields
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [userOptions, setUserOptions] = useState<LoginUserOption[]>([]);
  const [typingManually, setTypingManually] = useState(false);

  // Signup fields
  const [suName, setSuName] = useState("");
  const [suUser, setSuUser] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suPass2, setSuPass2] = useState("");
  const [suHide, setSuHide] = useState(false);

  const [busy, setBusy] = useState(false);

  const boot = async (force = false) => {
    setBootLoading(true);
    setSessionError(null);
    try {
      // 1. Load local accounts immediately (parallel, instant)
      const cached = await listCachedAccounts();
      const cachedOpts = cached.map(c => ({ id: c.user_id, name: c.name, username: c.username, role: c.role }));
      if (cachedOpts.length > 0) {
        setUserOptions(cachedOpts);
        setAccountsExist(true);
        setTab("login");
        // Preselect last-signed-in user so they only need to type the password.
        const last = getLastUsername();
        if (last && cachedOpts.some((o) => o.username === last)) {
          setLoginUser(last);
        }
        setBootLoading(false);
      }

      if (!isOnlineNow()) {
        if (cachedOpts.length === 0) setTypingManually(true);
        setBootLoading(false);
        return;
      }

      // 2. Try network with realistic timeout (real cellular / slow-Wi-Fi
      //    round-trips to Supabase regularly take 3-6 s; anything less
      //    false-fires "Network timeout" on a perfectly good connection).
      const sess = await withTimeout(ensureTechSession(force), 8000, { ok: false, reason: "Network timeout" } as any);
      
      if (!sess.ok) {
        // Fall back to local only
        if (cachedOpts.length === 0) {
          setSessionError(sess.reason);
          setAccountsExist(true);
          setTab("login");
          setTypingManually(true);
        }
        return;
      }

      const { data, error } = await withTimeout<{ data: boolean | null; error: { message?: string } | null }>(
        supabase.rpc("accounts_exist") as PromiseLike<{ data: boolean | null; error: { message?: string } | null }>,
        8000,
        { data: cachedOpts.length > 0, error: null }
      );
      if (error) throw error;
      
      // Never let a cloud "no accounts" response disable the login tab when
      // we already have cached accounts locally — offline-first must win.
      const exists = Boolean(data) || cachedOpts.length > 0;
      setAccountsExist(exists);
      setTab(exists ? "login" : "signup");

      if (exists) {
        const { data: list } = await withTimeout<{ data: LoginUserOption[] | null }>(
          (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: LoginUserOption[] | null }> }).rpc("list_login_users"),
          8000,
          { data: null }
        );
        if (list && list.length > 0) {
          setUserOptions(list);
        } else if (cachedOpts.length === 0) {
          setTypingManually(true);
        }
      }
    } catch (e) {
      console.warn("Boot network check failed, falling back to cache:", e);
      setAccountsExist(true);
      setTab("login");
    } finally {
      setBootLoading(false);
    }
  };


  useEffect(() => { void boot(); }, []);

  const onSignInAgain = async () => {
    setRefreshing(true);
    try {
      await boot(true);
    } finally {
      setRefreshing(false);
    }
  };


  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass) {
      toast.error("Pick a user and enter the password");
      return;
    }
    setBusy(true);
    try {
      const tryCloud = isOnlineNow();
      if (tryCloud) {
        try {
          let { data, error } = await withTimeout<any>(
            supabase.rpc("verify_account_login", {
              _username: loginUser.trim(),
              _password: loginPass,
            }) as PromiseLike<any>,
            10000,
            { data: null, error: { message: "Network timeout" } } as any,
          );
          if (error && /jwt|token/i.test(error.message ?? "")) {
            const r = await withTimeout(ensureTechSession(true), 8000, { ok: false, reason: "Network timeout" } as any);
            if (r.ok) {
              ({ data, error } = await withTimeout<any>(
                supabase.rpc("verify_account_login", {
                  _username: loginUser.trim(),
                  _password: loginPass,
                }) as PromiseLike<any>,
                10000,
                { data: null, error: { message: "Network timeout" } } as any,
              ));
            }
          }
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          if (!row?.id) {
            toast.error("Invalid username or password");
            return;
          }
          console.log("✅ Online login success for user:", row.name, `(${loginUser.trim()})`);
          void cacheAccountCredsFromCloud(loginUser.trim(), loginPass);

          try {
            if (isLocalOnlyMode()) throw new Error("Local-only mode: skip cloud company cache");
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

          markUnlocked({ id: row.id, name: row.name, role: row.role as StaffRole, username: loginUser.trim() });
          toast.success(`Welcome, ${row.name}`);
          navigate({ to: (consumeReturnTo() ?? "/app") as never });
          return;
        } catch (cloudErr) {
          const msg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr ?? "");
          if (!/network timeout|failed to fetch|networkerror|offline/i.test(msg)) {
            const reachable = await pingOnline();
            if (reachable) throw cloudErr;
          }
        }
      }

      const local = await verifyOfflineLogin(loginUser.trim(), loginPass);
      if (local) {
        markUnlocked({ id: local.id, name: local.name, role: local.role as StaffRole, username: loginUser.trim() });
        toast.success(`Welcome, ${local.name}`);
        navigate({ to: (consumeReturnTo() ?? "/app") as never });
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
      const { data: newId, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string } | null }>;
      }).rpc(rpc, {
        _name: suName.trim(),
        _username: suUser.trim(),
        _password: suPass,
        _hide_from_picker: suHide,
      });

      if (error) throw error;

      toast.success("Account created successfully!");
      markUnlocked({ id: newId as string, name: suName.trim(), role: "admin", username: suUser.trim() });
      navigate({ to: (consumeReturnTo() ?? "/app") as never });
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

  const showDropdown = !typingManually && userOptions.length > 0;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--amber-light)", color: "var(--amber-ink)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-lg"
        style={{
          background: "var(--amber-pale)",
          border: "1px solid color-mix(in oklab, var(--amber-dark) 45%, transparent)",
          color: "var(--amber-ink)",
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div
            className="rounded-lg p-2"
            style={{ background: "var(--amber-dark)", color: "var(--amber-onDark)" }}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--amber-ink)" }}>Smart Accountant</h1>
            <p className="text-xs" style={{ color: "color-mix(in oklab, var(--amber-ink) 65%, transparent)" }}>Sign in to manage your books</p>
          </div>
        </div>

        {sessionError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 space-y-2">
              <div>
                <div className="font-medium">Session expired</div>
                <div className="text-destructive/80">{sessionError}</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onSignInAgain}
                disabled={refreshing}
                className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {refreshing ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                )}
                Sign in again
              </Button>
            </div>
          </div>
        )}

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
                <Label htmlFor="login-user">User</Label>
                {showDropdown ? (
                  <Select
                    value={loginUser}
                    onValueChange={(v) => {
                      if (v === TYPE_MANUALLY) {
                        setTypingManually(true);
                        setLoginUser("");
                      } else {
                        setLoginUser(v);
                      }
                    }}
                  >
                    <SelectTrigger id="login-user" disabled={busy}>
                      <SelectValue placeholder="Select your account" />
                    </SelectTrigger>
                    <SelectContent>
                      {userOptions.map((u) => (
                        <SelectItem key={u.id} value={u.username}>
                          <div className="flex flex-col">
                            <span className="font-medium">{u.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              @{u.username} · {u.role}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value={TYPE_MANUALLY}>
                        <span className="italic text-muted-foreground">Type username manually…</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1">
                    <Input
                      id="login-user"
                      autoComplete="username"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      placeholder="Username"
                      disabled={busy}
                      autoFocus
                    />
                    {userOptions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setTypingManually(false); setLoginUser(""); }}
                        className="text-[11px] text-primary hover:underline"
                      >
                        ← Back to user list
                      </button>
                    )}
                  </div>
                )}
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
                  autoFocus={Boolean(loginUser)}
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
              <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
                <Checkbox
                  checked={suHide}
                  onCheckedChange={(v) => setSuHide(Boolean(v))}
                  disabled={busy}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <EyeOff className="h-3.5 w-3.5" /> Hide from login dropdown
                  </div>
                  <p className="text-muted-foreground mt-0.5">
                    Other people on this device won't see your username; you'll need to type it in.
                  </p>
                </div>
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                Sign up
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-5 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={() => navigate({ to: "/assistant" })}
          >
            <Bot className="h-4 w-4" />
            Diagnose with AI Assistant (offline, no login)
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Trouble signing in or syncing? Ask Mate first — works without an account or company.
          </p>
        </div>
      </div>
    </div>
  );
}
