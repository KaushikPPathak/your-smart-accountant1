import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, ShieldCheck, UserPlus, EyeOff, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { markUnlocked, getLastUsername, type StaffRole } from "@/lib/staff-session";
import { createLocalAccount, verifyOfflineLogin, listCachedAccounts } from "@/lib/offline/creds-cache";
import { consumeReturnTo } from "@/lib/return-to";

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

/**
 * Offline lock screen. Accounts live on this device only: they are created
 * here and checked against a local bcrypt hash. No sign-in call is made to
 * any server.
 */
function LockScreen() {
  const navigate = useNavigate();
  const [bootLoading, setBootLoading] = useState(true);
  const [accountsExist, setAccountsExist] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");

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

  const boot = async () => {
    setBootLoading(true);
    try {
      const cached = await listCachedAccounts();
      const cachedOpts = cached
        .filter((c) => !c.hidden)
        .map((c) => ({ id: c.user_id, name: c.name, username: c.username, role: c.role }));
      const exists = cached.length > 0;
      setAccountsExist(exists);
      setTab(exists ? "login" : "signup");
      setUserOptions(cachedOpts);
      if (cachedOpts.length === 0) {
        setTypingManually(true);
      } else {
        // Preselect the last account used on this device so only the password is needed.
        const last = getLastUsername();
        if (last && cachedOpts.some((o) => o.username === last)) setLoginUser(last);
      }
    } catch (e) {
      console.warn("Could not read local accounts:", e);
      setAccountsExist(false);
      setTab("signup");
    } finally {
      setBootLoading(false);
    }
  };

  useEffect(() => { void boot(); }, []);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass) {
      toast.error("Pick a user and enter the password");
      return;
    }
    setBusy(true);
    try {
      const local = await verifyOfflineLogin(loginUser.trim(), loginPass);
      if (!local) {
        toast.error("Invalid username or password");
        return;
      }
      markUnlocked({ id: local.id, name: local.name, role: local.role as StaffRole, username: loginUser.trim() });
      try {
        const { runPostLoginMigration } = await import("@/lib/post-login-migration");
        await runPostLoginMigration(local.id, local.name);
      } catch { /* ignore */ }
      navigate({ to: (consumeReturnTo() ?? "/app") as never });
    } catch (err) {
      // Lockout after repeated wrong passwords arrives here with its message.
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suName.trim()) return toast.error("Name is required");
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(suUser.trim()))
      return toast.error("User ID must be 3–40 chars");
    if (suPass.length < 6) return toast.error("Password must be at least 6 characters");
    if (suPass !== suPass2) return toast.error("Passwords do not match");

    setBusy(true);
    try {
      // The first account on a device is the admin; later ones are staff.
      const created = await createLocalAccount({
        name: suName,
        username: suUser,
        password: suPass,
        role: accountsExist ? "staff" : "admin",
        hidden: suHide,
      });
      markUnlocked({ id: created.id, name: created.name, role: created.role as StaffRole, username: suUser.trim() });
      try {
        const { runPostLoginMigration } = await import("@/lib/post-login-migration");
        await runPostLoginMigration(created.id, created.name);
      } catch { /* ignore */ }
      navigate({ to: (consumeReturnTo() ?? "/app") as never });
    } catch (err) {
      console.error("Sign-up failed:", err);
      toast.error(err instanceof Error ? err.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  };

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--amber-light)" }}>
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
