import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getActiveStaff, lockWorkspace } from "@/lib/staff-session";
import { useNavigate } from "@tanstack/react-router";

export function StaffPinPanel() {
  const me = getActiveStaff();
  const navigate = useNavigate();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [busy, setBusy] = useState(false);

  const onChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me?.id) return;
    if (next.length < 6) return toast.error("New password must be at least 6 characters");
    if (next !== next2) return toast.error("New passwords do not match");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("change_account_password", {
        _user_id: me.id,
        _old_password: cur,
        _new_password: next,
      });
      if (error) throw error;
      toast.success("Password updated");
      setCur(""); setNext(""); setNext2("");
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const onLogout = () => {
    lockWorkspace();
    navigate({ to: "/lock" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Account &amp; Security
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          Signed in as <span className="font-medium">{me?.name ?? "—"}</span>{" "}
          <span className="text-muted-foreground">({me?.role ?? "—"})</span>
        </div>

        <form onSubmit={onChange} className="space-y-3 max-w-md">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4" /> Change password
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np2">Confirm</Label>
              <Input id="np2" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} disabled={busy} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>

        <div>
          <Button variant="outline" onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" /> Log out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
