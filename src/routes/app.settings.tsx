import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Moon, Save, Sun, UserPlus, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useTheme } from "@/lib/theme-context";
import { getSetuStatus, saveSetuCredentials } from "@/utils/setu.functions";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — Your Mehtaji" }] }),
  component: SettingsPage,
});

interface Settings {
  invoice_prefix: string;
  invoice_starting_number: number;
  invoice_footer_note: string | null;
  invoice_terms: string | null;
  show_bank_details: boolean;
  show_signatory: boolean;
  gst_filing_frequency: "monthly" | "quarterly";
}

interface Member {
  user_id: string;
  role: "admin" | "accountant" | "viewer";
  email: string | null;
  full_name: string | null;
}

function SettingsPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings>({
    invoice_prefix: "INV",
    invoice_starting_number: 1,
    invoice_footer_note: "",
    invoice_terms: "",
    show_bank_details: true,
    show_signatory: true,
    gst_filing_frequency: "monthly",
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "accountant" | "viewer">("accountant");
  const [exporting, setExporting] = useState(false);
  // Setu / GST API credentials
  const [setuEnv, setSetuEnv] = useState<"sandbox" | "production">("sandbox");
  const [setuClientId, setSetuClientId] = useState("");
  const [setuClientSecret, setSetuClientSecret] = useState("");
  const [gstnUsername, setGstnUsername] = useState("");
  const [eiEnabled, setEiEnabled] = useState(false);
  const [ewbEnabled, setEwbEnabled] = useState(false);
  const [setuStatus, setSetuStatus] = useState<{ configured: boolean } | null>(null);
  const [savingSetu, setSavingSetu] = useState(false);

  const isAdmin = activeMembership?.role === "admin";

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const { data } = await supabase
        .from("company_settings")
        .select("invoice_prefix, invoice_starting_number, invoice_footer_note, invoice_terms, show_bank_details, show_signatory, gst_filing_frequency")
        .eq("company_id", activeCompanyId)
        .maybeSingle();
      if (data) setSettings(data as Settings);

      const { data: mem } = await supabase
        .from("company_members")
        .select("user_id, role")
        .eq("company_id", activeCompanyId);
      if (mem) {
        const ids = mem.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", ids);
        const profMap = new Map((profiles || []).map((p) => [p.user_id, p]));
        setMembers(
          mem.map((m) => ({
            user_id: m.user_id,
            role: m.role as Member["role"],
            email: profMap.get(m.user_id)?.email ?? null,
            full_name: profMap.get(m.user_id)?.full_name ?? null,
          })),
        );
      }

      // Load Setu status (admin only)
      if (isAdmin) {
        try {
          const s = await getSetuStatus({ data: { companyId: activeCompanyId } });
          setSetuStatus({ configured: s.configured });
          setSetuEnv((s.environment as "sandbox" | "production") || "sandbox");
          setEiEnabled(s.einvoice_enabled);
          setEwbEnabled(s.ewaybill_enabled);
          setGstnUsername(s.gstn_username ?? "");
        } catch { /* not admin or no row yet */ }
      }
    })();
  }, [activeCompanyId, isAdmin]);

  const saveSetu = async () => {
    if (!activeCompanyId) return;
    if (!setuClientId || !setuClientSecret) {
      toast.error("Setu Client ID and Secret are required");
      return;
    }
    setSavingSetu(true);
    try {
      const res = await saveSetuCredentials({
        data: {
          companyId: activeCompanyId,
          environment: setuEnv,
          setuClientId, setuClientSecret,
          gstnUsername: gstnUsername || undefined,
          einvoiceEnabled: eiEnabled,
          ewaybillEnabled: ewbEnabled,
        },
      });
      if (res.success) {
        toast.success("Setu credentials saved");
        setSetuClientSecret(""); // clear from memory
        setSetuStatus({ configured: true });
      } else {
        toast.error(res.error ?? "Failed to save");
      }
    } finally {
      setSavingSetu(false);
    }
  };

  const saveSettings = async () => {
    if (!activeCompanyId) return;
    setSavingSettings(true);
    const { error } = await supabase
      .from("company_settings")
      .upsert({ company_id: activeCompanyId, ...settings }, { onConflict: "company_id" });
    setSavingSettings(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  const inviteMember = async () => {
    if (!activeCompanyId || !inviteEmail) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", inviteEmail.trim().toLowerCase())
      .maybeSingle();
    if (!prof) {
      toast.error("No user with that email. Ask them to sign up first.");
      return;
    }
    const { error } = await supabase
      .from("company_members")
      .insert({ company_id: activeCompanyId, user_id: prof.user_id, role: inviteRole });
    if (error) { toast.error(error.message); return; }
    toast.success("User added");
    setInviteEmail("");
    // refresh
    const { data: mem } = await supabase
      .from("company_members").select("user_id, role").eq("company_id", activeCompanyId);
    if (mem) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, email, full_name").in("user_id", mem.map((m) => m.user_id));
      const profMap = new Map((profiles || []).map((p) => [p.user_id, p]));
      setMembers(mem.map((m) => ({
        user_id: m.user_id, role: m.role as Member["role"],
        email: profMap.get(m.user_id)?.email ?? null,
        full_name: profMap.get(m.user_id)?.full_name ?? null,
      })));
    }
  };

  const updateRole = async (userId: string, role: Member["role"]) => {
    if (!activeCompanyId) return;
    const { error } = await supabase
      .from("company_members").update({ role }).eq("company_id", activeCompanyId).eq("user_id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("Role updated");
    setMembers((cur) => cur.map((m) => (m.user_id === userId ? { ...m, role } : m)));
  };

  const removeMember = async (userId: string) => {
    if (!activeCompanyId) return;
    if (!confirm("Remove this user from the company?")) return;
    const { error } = await supabase
      .from("company_members").delete().eq("company_id", activeCompanyId).eq("user_id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    setMembers((cur) => cur.filter((m) => m.user_id !== userId));
  };

  const exportBackup = async () => {
    if (!activeCompanyId) return;
    setExporting(true);
    try {
      const [c, l, i, v, vi, ve, s] = await Promise.all([
        supabase.from("companies").select("*").eq("id", activeCompanyId).single(),
        supabase.from("ledgers").select("*").eq("company_id", activeCompanyId),
        supabase.from("items").select("*").eq("company_id", activeCompanyId),
        supabase.from("vouchers").select("*").eq("company_id", activeCompanyId),
        supabase.from("voucher_items").select("*, vouchers!inner(company_id)").eq("vouchers.company_id", activeCompanyId),
        supabase.from("voucher_entries").select("*, vouchers!inner(company_id)").eq("vouchers.company_id", activeCompanyId),
        supabase.from("company_settings").select("*").eq("company_id", activeCompanyId).maybeSingle(),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        company: c.data,
        ledgers: l.data,
        items: i.data,
        vouchers: v.data,
        voucher_items: vi.data,
        voucher_entries: ve.data,
        settings: s.data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${c.data?.name?.replace(/\s+/g, "_")}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Customize invoices, manage users, theme and backups for {activeMembership?.companies.name ?? "—"}.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Theme</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" /> Light
          </Button>
          <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" /> Dark
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice customization</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Invoice prefix</Label>
              <Input value={settings.invoice_prefix} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} placeholder="INV / BILL / TAX" />
            </div>
            <div className="space-y-1.5">
              <Label>Starting number</Label>
              <Input type="number" value={settings.invoice_starting_number} onChange={(e) => setSettings({ ...settings, invoice_starting_number: parseInt(e.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Footer note</Label>
              <Input value={settings.invoice_footer_note ?? ""} onChange={(e) => setSettings({ ...settings, invoice_footer_note: e.target.value })} placeholder="Thank you for your business!" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Terms & conditions</Label>
              <Textarea rows={4} value={settings.invoice_terms ?? ""} onChange={(e) => setSettings({ ...settings, invoice_terms: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <Label>Show bank details on invoice</Label>
              <Switch checked={settings.show_bank_details} onCheckedChange={(v) => setSettings({ ...settings, show_bank_details: v })} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <Label>Show signatory section</Label>
              <Switch checked={settings.show_signatory} onCheckedChange={(v) => setSettings({ ...settings, show_signatory: v })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>GST filing frequency</Label>
              <Select value={settings.gst_filing_frequency} onValueChange={(v) => setSettings({ ...settings, gst_filing_frequency: v as "monthly" | "quarterly" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly (turnover &gt; ₹5 Cr or opted-out of QRMP)</SelectItem>
                  <SelectItem value="quarterly">Quarterly (QRMP — turnover up to ₹5 Cr)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Used by GSTR-1 / IFF and GSTR-3B reports.</p>
            </div>
          </div>
          <Button onClick={saveSettings} disabled={savingSettings || !isAdmin}>
            <Save className="mr-2 h-4 w-4" /> {savingSettings ? "Saving…" : "Save settings"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">User management</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label>Email</Label>
                <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Member["role"])}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="accountant">Accountant</SelectItem>
                    <SelectItem value="viewer">View only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={inviteMember}><UserPlus className="mr-2 h-4 w-4" /> Add user</Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-[100px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>{m.full_name ?? "—"}</TableCell>
                  <TableCell>{m.email ?? "—"}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select value={m.role} onValueChange={(v) => updateRole(m.user_id, v as Member["role"])}>
                        <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="accountant">Accountant</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : <span className="capitalize">{m.role}</span>}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeMember(m.user_id)}>Remove</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Users must sign up first; once they have an account, you can add them by email.
          </p>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> GST APIs (Setu) {setuStatus?.configured && <span className="text-xs font-normal text-primary">● Connected</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Connect your Setu GSP account for one-click E-Invoice (IRN) and E-Way Bill generation. Sign up at <a href="https://setu.co/products/gst" target="_blank" rel="noreferrer" className="underline">setu.co/products/gst</a> and copy your Client ID & Secret. Credentials are stored encrypted and only used server-side.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Environment</Label>
                <Select value={setuEnv} onValueChange={(v) => setSetuEnv(v as "sandbox" | "production")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox (UAT — for testing)</SelectItem>
                    <SelectItem value="production">Production (live filings)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>GSTN Portal Username (optional)</Label>
                <Input value={gstnUsername} onChange={(e) => setGstnUsername(e.target.value)} placeholder="GST portal user ID" />
              </div>
              <div className="space-y-1.5">
                <Label>Setu Client ID</Label>
                <Input value={setuClientId} onChange={(e) => setSetuClientId(e.target.value)} placeholder="From Setu dashboard" />
              </div>
              <div className="space-y-1.5">
                <Label>Setu Client Secret</Label>
                <Input type="password" value={setuClientSecret} onChange={(e) => setSetuClientSecret(e.target.value)} placeholder={setuStatus?.configured ? "•••• (leave blank to keep)" : "From Setu dashboard"} />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <Label>Enable E-Invoice (IRN)</Label>
                <Switch checked={eiEnabled} onCheckedChange={setEiEnabled} />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <Label>Enable E-Way Bill</Label>
                <Switch checked={ewbEnabled} onCheckedChange={setEwbEnabled} />
              </div>
            </div>
            <Button onClick={saveSetu} disabled={savingSetu}>
              <Save className="mr-2 h-4 w-4" /> {savingSetu ? "Saving…" : "Save GST API credentials"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Data backup</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Download a JSON snapshot of all data for this company.</p>
          <Button variant="outline" onClick={exportBackup} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Download backup"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
