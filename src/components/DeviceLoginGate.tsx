import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDeviceLogin, hasDeviceLogin, resetDeviceLogin, verifyDeviceLogin } from "@/lib/device-login";
import { POLICY_HELP } from "@/lib/local-company-access";

/** One sign-in for this computer. Shown before the company list; once passed, every company opens. */
export function DeviceLoginGate({ onReady }: { onReady: () => void }) {
  const [setup] = useState(() => !hasDeviceLogin());
  const [forgot, setForgot] = useState(false);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (setup) {
        if (pwd !== confirm) {
          toast.error("The two passwords do not match");
          return;
        }
        setNewCode(await createDeviceLogin(pwd));
      } else if (forgot) {
        setNewCode(await resetDeviceLogin(code, pwd));
      } else {
        const ok = await verifyDeviceLogin(pwd);
        if (!ok) {
          toast.error("Wrong password");
          setPwd("");
          return;
        }
        onReady();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  if (newCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Write down your recovery code</h1>
          <p className="text-sm text-muted-foreground">
            This code is the only way back in if you forget the password. It is shown once.
          </p>
          <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-widest">{newCode}</div>
          <Button className="w-full" onClick={onReady}>I have written it down</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">
          {setup ? "Create sign-in for this computer" : forgot ? "Reset password" : "Sign in"}
        </h1>
        {setup && (
          <p className="text-sm text-muted-foreground">
            Sign in once here and every company on this computer opens without another password.
          </p>
        )}
        {forgot && (
          <div className="space-y-1.5">
            <Label htmlFor="dcode">Recovery code</Label>
            <Input id="dcode" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="dpwd">{forgot ? "New password" : "Password"}</Label>
          <Input
            id="dpwd"
            type="password"
            autoFocus={!forgot}
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder={setup || forgot ? POLICY_HELP.strict : ""}
          />
        </div>
        {setup && (
          <div className="space-y-1.5">
            <Label htmlFor="dpwd2">Confirm password</Label>
            <Input id="dpwd2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        )}
        {!setup && (
          <button type="button" className="text-xs text-primary underline" onClick={() => { setForgot((f) => !f); setPwd(""); setCode(""); }}>
            {forgot ? "Back to sign in" : "Forgot password?"}
          </button>
        )}
        <Button type="submit" className="w-full" disabled={busy || !pwd || (setup && !confirm)}>
          {busy ? "Checking..." : setup ? "Create and continue" : forgot ? "Reset and continue" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
