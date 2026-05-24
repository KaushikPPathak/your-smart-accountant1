import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, User as UserIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getActiveStaff, type StaffRole } from "@/lib/staff-session";

interface StaffRow {
  id: string;
  name: string;
  role: StaffRole;
  last_unlock_at: string | null;
}

export function StaffPinPanel() {
  const me = getActiveStaff();
  const isMeAdmin = me?.role === "admin";
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Add staff
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState<StaffRole>("staff");
  const [addPin, setAddPin] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset
  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);
  const [resetNewPin, setResetNewPin] = useState("");
  const [resetAdminPin, setResetAdminPin] = useState("");

  // Delete
  const [delTarget, setDelTarget] = useState<StaffRow | null>(null);
  const [delAdminPin, setDelAdminPin] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_users")
      .select("id, name, role, last_unlock_at")
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as StaffRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!isMeAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Staff & PINs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Only admins can manage staff PIN accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const doAdd = async () => {
    if (!me) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_app_user", {
        _admin_id: me.id,
        _admin_pin: adminPin,
        _name: addName,
        _role: addRole,
        _pin: addPin,
      });
      if (error) throw error;
      toast.success("Staff added");
      setAddOpen(false);
      setAddName("");
      setAddPin("");
      setAdminPin("");
      setAddRole("staff");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!me || !resetTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("reset_app_user_pin", {
        _admin_id: me.id,
        _admin_pin: resetAdminPin,
        _target_id: resetTarget.id,
        _new_pin: resetNewPin,
      });
      if (error) throw error;
      toast.success(`PIN reset for ${resetTarget.name}`);
      setResetTarget(null);
      setResetNewPin("");
      setResetAdminPin("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!me || !delTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("delete_app_user", {
        _admin_id: me.id,
        _admin_pin: delAdminPin,
        _target_id: delTarget.id,
      });
      if (error) throw error;
      toast.success(`Removed ${delTarget.name}`);
      setDelTarget(null);
      setDelAdminPin("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Staff & PINs
          </span>
          <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setAddName(""); setAddPin(""); setAdminPin(""); } }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add staff</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add staff member</DialogTitle>
                <DialogDescription>Enter your admin PIN to confirm.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={addName} onChange={(e) => setAddName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select value={addRole} onValueChange={(v) => setAddRole(v as StaffRole)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>New PIN (4–6 digits)</Label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={addPin}
                      onChange={(e) => setAddPin(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Your admin PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={doAdd} disabled={busy || !addName || addPin.length < 4 || adminPin.length < 4}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last unlock</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.name}
                      {me?.id === r.id && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">you</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{r.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.last_unlock_at ? new Date(r.last_unlock_at).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setResetTarget(r); setResetNewPin(""); setResetAdminPin(""); }}
                    >
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Reset PIN
                    </Button>
                    {me?.id !== r.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setDelTarget(r); setDelAdminPin(""); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Reset PIN dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset PIN for {resetTarget?.name}</DialogTitle>
            <DialogDescription>Enter your admin PIN to confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New PIN (4–6 digits)</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={resetNewPin}
                onChange={(e) => setResetNewPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Your admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={resetAdminPin}
                onChange={(e) => setResetAdminPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={doReset} disabled={busy || resetNewPin.length < 4 || resetAdminPin.length < 4}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {delTarget?.name}?</DialogTitle>
            <DialogDescription>This staff member will no longer be able to unlock the app.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Your admin PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={delAdminPin}
              onChange={(e) => setDelAdminPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busy || delAdminPin.length < 4}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
