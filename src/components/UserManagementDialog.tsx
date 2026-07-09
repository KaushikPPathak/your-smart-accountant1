// Admin-gated dialog for creating / editing / deleting login accounts (app_users).
// Reached from the Companies page → "Manage users" button.
//
// Workflow:
//   1. Active staff must be an admin. We re-prompt for their account password.
//   2. After verification, list every account via list_accounts_admin().
//   3. Inline edit: rename, change role, hide/unhide from login dropdown,
//      activate/deactivate, reset password. Delete with confirmation.

import { toTitleCaseOnType } from "@/lib/text-case";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, ShieldCheck, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getActiveStaff } from "@/lib/staff-session";

interface AccountRow {
  id: string;
  name: string;
  username: string;
  role: "admin" | "staff";
  is_active: boolean;
  hide_from_picker: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserManagementDialog({ open, onOpenChange }: Props) {
  const staff = getActiveStaff();
  const [adminPass, setAdminPass] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setAdminPass("");
    setVerified(false);
    setRows([]);
    setEditing(null);
    setCreating(false);
  };

  const closeDialog = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const errMsg = (e: unknown) =>
    (e as { message?: string })?.message ||
    (e as { details?: string })?.details ||
    "Something went wrong";

  const loadList = async () => {
    if (!staff) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: AccountRow[] | null; error: { message: string } | null }>;
      }).rpc("list_accounts_admin", { _admin_id: staff.id, _admin_password: adminPass });
      if (error) throw error;
      setRows(data ?? []);
      setVerified(true);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPass) return toast.error("Enter your admin password");
    await loadList();
  };

  const handleSaveEdit = async (target: AccountRow, newPassword: string) => {
    if (!staff) return;
    setBusy(true);
    try {
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("update_account_admin", {
        _admin_id: staff.id,
        _admin_password: adminPass,
        _target_id: target.id,
        _new_name: target.name,
        _new_role: target.role,
        _is_active: target.is_active,
        _hide_from_picker: target.hide_from_picker,
        _new_password: newPassword || null,
      });
      if (error) throw error;
      toast.success("Account updated");
      setEditing(null);
      await loadList();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (target: AccountRow) => {
    if (!staff) return;
    if (!confirm(`Delete account "${target.username}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("delete_account_admin", {
        _admin_id: staff.id, _admin_password: adminPass, _target_id: target.id,
      });
      if (error) throw error;
      toast.success("Account deleted");
      await loadList();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (form: { name: string; username: string; password: string; hide: boolean }) => {
    setBusy(true);
    try {
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("signup_account", {
        _name: form.name.trim(),
        _username: form.username.trim(),
        _password: form.password,
        _hide_from_picker: form.hide,
      });
      if (error) throw error;
      toast.success("Account created");
      setCreating(false);
      await loadList();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Manage login accounts
          </DialogTitle>
        </DialogHeader>

        {!verified ? (
          <form onSubmit={handleVerify} className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Confirm your admin password to manage other login accounts.
            </p>
            <div className="space-y-1.5">
              <Label>Admin: {staff?.name}</Label>
              <Input
                type="password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                placeholder="Your password"
                autoFocus
                disabled={busy}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rows.length} account{rows.length === 1 ? "" : "s"}
              </p>
              <Button size="sm" onClick={() => setCreating(true)} disabled={busy}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New user
              </Button>
            </div>

            <div className="max-h-[55vh] space-y-2 overflow-y-auto rounded-md border p-2">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <Badge variant={r.role === "admin" ? "default" : "secondary"}>{r.role}</Badge>
                      {!r.is_active && <Badge variant="outline">inactive</Badge>}
                      {r.hide_from_picker && (
                        <Badge variant="outline" className="gap-1">
                          <EyeOff className="h-3 w-3" /> hidden
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">@{r.username}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)} disabled={busy}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(r)} disabled={busy || r.id === staff?.id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No accounts</p>
              )}
            </div>
          </div>
        )}

        {editing && (
          <EditAccountForm
            account={editing}
            onCancel={() => setEditing(null)}
            onSave={(updated, pwd) => handleSaveEdit(updated, pwd)}
            busy={busy}
          />
        )}

        {creating && (
          <CreateAccountForm
            onCancel={() => setCreating(false)}
            onSave={handleCreate}
            busy={busy}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditAccountForm({
  account, onCancel, onSave, busy,
}: {
  account: AccountRow;
  onCancel: () => void;
  onSave: (updated: AccountRow, newPassword: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<AccountRow>({ ...account });
  const [newPwd, setNewPwd] = useState("");

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-semibold">Edit @{account.username}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: toTitleCaseOnType(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Role</Label>
          <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v as "admin" | "staff" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Reset password (leave blank to keep current)</Label>
          <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="New password (min 6 chars)" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 pt-1 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: Boolean(v) })} />
          Active
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={draft.hide_from_picker} onCheckedChange={(v) => setDraft({ ...draft, hide_from_picker: Boolean(v) })} />
          Hide from login dropdown
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSave(draft, newPwd)} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function CreateAccountForm({
  onCancel, onSave, busy,
}: {
  onCancel: () => void;
  onSave: (form: { name: string; username: string; password: string; hide: boolean }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hide, setHide] = useState(false);

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <p className="text-sm font-semibold">Create new account</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Username *</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3-40 chars" />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Password * (min 6 chars)</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={hide} onCheckedChange={(v) => setHide(Boolean(v))} />
        <Eye className="h-3.5 w-3.5 text-muted-foreground" /> Hide this user from the login dropdown
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSave({ name, username, password, hide })} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Create
        </Button>
      </div>
    </div>
  );
}
