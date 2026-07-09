import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Database, Download, Moon, Save, Sun, Upload, UserPlus, KeyRound, Lock as LockIcon, Trash2 } from "lucide-react";
import {
  exportAllCompaniesBackup,
  exportCompanyBackup,
  parseBackupFile,
  restoreCompanyBackup,
} from "@/lib/backup";
import { savePreRestoreSnapshot } from "@/lib/restore-safety";
import { runSemanticChecks } from "@/lib/semantic-checks";
import { preflightIntegrityToast } from "@/lib/offline/integrity-preflight";
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
import { useI18n } from "@/lib/i18n";
import { getSetuStatus, saveSetuCredentials } from "@/utils/setu.functions";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { StaffPinPanel } from "@/components/StaffPinPanel";
import { DataLocationCard } from "@/components/settings/DataLocationCard";
import { CloudBackupCard } from "@/components/settings/CloudBackupCard";
import { ReleaseChannelPicker } from "@/components/settings/ReleaseChannelPicker";

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
  const { activeCompanyId, activeMembership, memberships, refresh: refreshCompanies } = useCompany();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [wipeBeforeRestore, setWipeBeforeRestore] = useState(false);
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

  // ---- Company access password ----
  const [hasCompanyPwd, setHasCompanyPwd] = useState<boolean>(false);
  const [newCompanyPwd, setNewCompanyPwd] = useState("");
  const [savingCompanyPwd, setSavingCompanyPwd] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const { data } = await supabase
        .from("companies_picker")
        .select("has_password")
        .eq("id", activeCompanyId)
        .maybeSingle();
      setHasCompanyPwd(!!data?.has_password);
    })();
  }, [activeCompanyId]);

  const saveCompanyPwd = async (clear: boolean) => {
    if (!activeCompanyId) return;
    if (!clear && newCompanyPwd.length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    setSavingCompanyPwd(true);
    try {
      const { error } = await supabase.rpc("set_company_password", {
        _company_id: activeCompanyId,
        _new_password: clear ? "" : newCompanyPwd,
      });
      if (error) throw error;
      toast.success(clear ? "Password removed" : "Password set");
      setHasCompanyPwd(!clear);
      setNewCompanyPwd("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save password");
    } finally {
      setSavingCompanyPwd(false);
    }
  };

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
      const name = activeMembership?.companies.name ?? "company";
      await preflightIntegrityToast(activeCompanyId, "backup");
      const res = await exportCompanyBackup(activeCompanyId, name);
      toast.success(res.desktopPath ? `Saved to ${res.desktopPath}` : `Downloaded ${res.fileName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async () => {
    if (!memberships.length) return;
    setExportingAll(true);
    try {
      const list = memberships.map((m) => ({ id: m.company_id, name: m.companies.name }));
      const res = await exportAllCompaniesBackup(list);
      toast.success(res.desktopPath ? `Saved to ${res.desktopPath}` : `Downloaded ${res.fileName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setExportingAll(false);
    }
  };

  const onRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeCompanyId) return;
    if (!isAdmin) { toast.error("Only admins can restore"); return; }
    // Strict restore rule: always wipe target company data before restoring
    // to guarantee "overwrite existing, add missing" semantics — never duplicate.
    const targetName = activeMembership?.companies.name ?? "";
    const typed = prompt(
      `STRICT RESTORE — this will DELETE all current data in "${targetName}" and replace it with the backup.\n\n` +
      `Type the company name exactly to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== targetName) { toast.error(`Name did not match "${targetName}" — restore cancelled.`); return; }
    setRestoring(true);
    try {
      await preflightIntegrityToast(activeCompanyId, "restore");
      const text = await file.text();
      const parsed = await parseBackupFile(text);
      if (parsed.checksumOk === false) toast.warning("Backup checksum mismatch — file may be corrupted or edited.");
      if (parsed.kind !== "single") {
        throw new Error(
          "This is an all-companies backup. Do not restore it into one company. Use Companies → Restore from file so each company is restored separately.",
        );
      }
      const single = parsed.data;
      if (!single) throw new Error("Backup file is empty");
      // Rule 5 — silent pre-restore snapshot for 24h undo (Housekeeping → Undo restore).
      const snap = await savePreRestoreSnapshot(activeCompanyId, targetName);
      if (!snap.ok) toast.warning("Could not create safety snapshot — proceeding without undo option.");
      const summary = await restoreCompanyBackup(activeCompanyId, single, { wipeExisting: true });
      toast.success(
        `Restored: ${summary.ledgers} ledgers, ${summary.items} items, ${summary.vouchers} vouchers`,
      );
      // Rule 6 — post-restore semantic verification.
      try {
        const report = await runSemanticChecks(activeCompanyId);
        if (report.hasError) toast.error(`Verified with CRITICAL issues: ${report.summary}`, { duration: 12000 });
        else if (report.hasWarning) toast.warning(`Verified: ${report.summary}`, { duration: 8000 });
        else toast.success(`Verified — ${report.summary}`);
      } catch { /* non-fatal */ }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("settings.subtitle")} {activeMembership?.companies.name ?? "—"}.
        </p>
      </div>

      <DataLocationCard />
      <CloudBackupCard />

      <Card>
        <CardHeader><CardTitle className="text-base">Release channel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong>Stable</strong> — the tested, released version. Recommended for daily bookkeeping.
            <br />
            <strong>Beta</strong> — get new features first. May contain bugs. Please report anything odd.
          </p>
          <ReleaseChannelPicker />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Diagnostics</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            View errors and failures recorded on this device. Nothing is sent to any server.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/diagnostics" })}>
            Open diagnostics
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Release checklist</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Printable pre-release sign-off. Verify every box before shipping a new version.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/release-checklist" })}>
            Open checklist
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Tax templates</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Reusable GST/Cess presets. Vouchers auto-apply silently; a picker appears only when
            more than one template fits.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/settings/tax-templates" })}>
            Manage templates
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cost centres &amp; categories</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Tag voucher lines by branch, project, or cost pool. Pickers stay hidden until at
            least one cost centre is configured.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/settings/cost-centres" })}>
            Manage cost centres
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Bill-wise opening balances</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Enter unpaid invoices carried over from before your changeover date so ageing
            buckets and receipt / payment allocation work correctly from day 1.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/settings/opening-bills" })}>
            Manage opening bills
          </Button>
        </CardContent>
      </Card>



      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.theme")}</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" /> {t("settings.light")}
          </Button>
          <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" /> {t("settings.dark")}
          </Button>
        </CardContent>
      </Card>

      <StaffPinPanel />



      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LockIcon className="h-4 w-4" /> {t("settings.companyPwd")}
              {hasCompanyPwd ? (
                <span className="text-xs font-normal text-primary">{t("settings.companyPwd.set")}</span>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">{t("settings.companyPwd.notSet")}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("settings.companyPwd.help")}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label>{hasCompanyPwd ? t("settings.companyPwd.new") : t("settings.companyPwd.setLabel")}</Label>
                <Input
                  type="password"
                  value={newCompanyPwd}
                  onChange={(e) => setNewCompanyPwd(e.target.value)}
                  placeholder={t("settings.companyPwd.minHint")}
                  autoComplete="new-password"
                />
              </div>
              <Button onClick={() => saveCompanyPwd(false)} disabled={savingCompanyPwd || !newCompanyPwd}>
                <Save className="mr-2 h-4 w-4" /> {hasCompanyPwd ? t("settings.companyPwd.changeBtn") : t("settings.companyPwd.setLabel")}
              </Button>
              {hasCompanyPwd && (
                <Button variant="outline" onClick={() => saveCompanyPwd(true)} disabled={savingCompanyPwd}>
                  {t("settings.companyPwd.removeBtn")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.invoice")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("settings.invoice.prefix")}</Label>
              <Input value={settings.invoice_prefix} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} placeholder="INV / BILL / TAX" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.invoice.starting")}</Label>
              <Input type="number" value={settings.invoice_starting_number} onChange={(e) => setSettings({ ...settings, invoice_starting_number: parseInt(e.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t("settings.invoice.footer")}</Label>
              <Input value={settings.invoice_footer_note ?? ""} onChange={(e) => setSettings({ ...settings, invoice_footer_note: e.target.value })} placeholder="Thank you for your business!" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t("settings.invoice.terms")}</Label>
              <Textarea rows={4} value={settings.invoice_terms ?? ""} onChange={(e) => setSettings({ ...settings, invoice_terms: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <Label>{t("settings.invoice.bank")}</Label>
              <Switch checked={settings.show_bank_details} onCheckedChange={(v) => setSettings({ ...settings, show_bank_details: v })} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <Label>{t("settings.invoice.signatory")}</Label>
              <Switch checked={settings.show_signatory} onCheckedChange={(v) => setSettings({ ...settings, show_signatory: v })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t("settings.invoice.gstFreq")}</Label>
              <Select value={settings.gst_filing_frequency} onValueChange={(v) => setSettings({ ...settings, gst_filing_frequency: v as "monthly" | "quarterly" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly (turnover &gt; ₹5 Cr or opted-out of QRMP)</SelectItem>
                  <SelectItem value="quarterly">Quarterly (QRMP — turnover up to ₹5 Cr)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("settings.invoice.gstFreq.help")}</p>
            </div>
          </div>
          <Button onClick={saveSettings} disabled={savingSettings || !isAdmin}>
            <Save className="mr-2 h-4 w-4" /> {savingSettings ? t("settings.invoice.saving") : t("settings.invoice.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.users")}</CardTitle></CardHeader>
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
            Multi-user invites are disabled in this build. Use Company access password above to control who can open this company.
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
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Backup &amp; Restore
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">This company</p>
            <p className="text-xs text-muted-foreground">
              Download a JSON snapshot of every ledger, item, voucher, allocation and recurring template for{" "}
              <span className="font-medium text-foreground">{activeMembership?.companies.name ?? "—"}</span>.
              On the Windows app, files are auto-saved to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">Documents/YourMehtaji/&lt;Company&gt;/backups/</code>.
            </p>
            <Button variant="outline" onClick={exportBackup} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Download company backup"}
            </Button>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">All companies ({memberships.length})</p>
            <p className="text-xs text-muted-foreground">
              One file containing snapshots of every company you have access to. Useful for off-site safekeeping.
            </p>
            <Button variant="outline" onClick={exportAll} disabled={exportingAll || memberships.length === 0}>
              <Download className="mr-2 h-4 w-4" /> {exportingAll ? "Exporting all…" : "Download all-companies backup"}
            </Button>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Restore into this company</p>
            <p className="text-xs text-muted-foreground">
              Imports a backup JSON into <span className="font-medium text-foreground">{activeMembership?.companies.name ?? "—"}</span>.
              Multi-company files restore only the first company — switch companies and run again for the rest.
            </p>
            <div className="flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <div>
                  <div className="font-medium text-foreground">Wipe existing data first</div>
                  <div className="text-muted-foreground">Deletes current ledgers, items, vouchers before importing. Cannot be undone.</div>
                </div>
              </div>
              <Switch checked={wipeBeforeRestore} onCheckedChange={setWipeBeforeRestore} />
            </div>
            <input
              ref={restoreFileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={onRestoreFile}
            />
            <Button
              variant="outline"
              onClick={() => restoreFileRef.current?.click()}
              disabled={restoring || !isAdmin}
            >
              <Upload className="mr-2 h-4 w-4" /> {restoring ? "Restoring…" : "Choose backup file…"}
            </Button>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">Only company admins can restore.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Delete this company</p>
                <p className="text-xs text-muted-foreground">
                  Permanently removes <span className="font-semibold">{activeMembership?.companies.name}</span> and all its vouchers, ledgers, items, and settings. This cannot be undone.
                </p>
              </div>
              <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleteConfirm(""); }}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete company
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-4 w-4" /> Delete company
                    </DialogTitle>
                    <DialogDescription>
                      This will permanently delete <span className="font-semibold">{activeMembership?.companies.name}</span> and all of its data. Type the company name to confirm.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="delete-confirm">Company name</Label>
                    <Input
                      id="delete-confirm"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder={activeMembership?.companies.name ?? ""}
                      autoComplete="off"
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={deleting || deleteConfirm.trim() !== (activeMembership?.companies.name ?? "").trim()}
                      onClick={async () => {
                        if (!activeCompanyId) return;
                        setDeleting(true);
                        const { error } = await supabase
                          .from("companies")
                          .delete()
                          .eq("id", activeCompanyId);
                        setDeleting(false);
                        if (error) {
                          toast.error(error.message || "Failed to delete company");
                          return;
                        }
                        toast.success("Company deleted");
                        setDeleteOpen(false);
                        setDeleteConfirm("");
                        if (typeof window !== "undefined") {
                          localStorage.removeItem("ym_active_company_id");
                        }
                        await refreshCompanies();
                        navigate({ to: "/app/companies" });
                      }}
                    >
                      {deleting ? "Deleting…" : "Delete permanently"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
