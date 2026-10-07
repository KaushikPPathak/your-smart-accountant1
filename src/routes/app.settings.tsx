import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Database, Download, Moon, Save, Sun, Upload, UserPlus, KeyRound, Lock as LockIcon, Trash2, History } from "lucide-react";
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
import { UpiQrSettingsCard } from "@/components/settings/UpiQrSettingsCard";
import { ConnectAccountCard } from "@/components/settings/ConnectAccountCard";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import {
  listCompanyUsers, upsertCompanyUser, resetUserPassword, setUserRole, removeCompanyUser,
  clearCompanyAccess, OWNER_NAME, type LocalCompanyUser,
} from "@/lib/local-company-access";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — Your Mehtaji" }] }),
  component: SettingsRouteComponent,
});

function SettingsRouteComponent() {
  const location = useLocation();
  const p = location.pathname.replace(/\/$/, "");
  if (p !== "/app/settings") return <Outlet />;
  return <SettingsPage />;
}

interface Settings {
  invoice_prefix: string;
  invoice_starting_number: number;
  invoice_footer_note: string | null;
  invoice_terms: string | null;
  show_bank_details: boolean;
  show_signatory: boolean;
  gst_filing_frequency: "monthly" | "quarterly";
  reminders_enabled: boolean;
  audit_case_reminders: boolean;
  gst_check_interval: "always" | "monthly" | "quarterly" | "half_yearly" | "yearly";
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
  const [deleteScope, setDeleteScope] = useState<"local" | "local_and_remote">(() => {
    if (typeof window === "undefined") return "local";
    const v = window.localStorage.getItem("ym_delete_company_scope");
    return v === "local_and_remote" ? "local_and_remote" : "local";
  });
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [wipeBeforeRestore, setWipeBeforeRestore] = useState(false);
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings & { dismissed_notifications?: string[] }>({
    invoice_prefix: "INV",
    invoice_starting_number: 1,
    invoice_footer_note: "",
    invoice_terms: "",
    show_bank_details: true,
    show_signatory: true,
    gst_filing_frequency: "monthly",
    reminders_enabled: true,
    audit_case_reminders: false,
    gst_check_interval: "quarterly",
    dismissed_notifications: [],
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

  // ---- Company access password & users (saved only on this computer) ----
  const [hasCompanyPwd, setHasCompanyPwd] = useState<boolean>(false);
  const [newCompanyPwd, setNewCompanyPwd] = useState("");
  const [savingCompanyPwd, setSavingCompanyPwd] = useState(false);
  const [localUsers, setLocalUsers] = useState<LocalCompanyUser[]>([]);
  const [newUserPwd, setNewUserPwd] = useState("");

  const refreshLocalUsers = () => {
    if (!activeCompanyId) return;
    const list = listCompanyUsers(activeCompanyId);
    setLocalUsers(list);
    setHasCompanyPwd(list.length > 0);
  };

  useEffect(() => { refreshLocalUsers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  const saveCompanyPwd = async (clear: boolean) => {
    if (!activeCompanyId) return;
    if (clear) {
      if (!confirm("Remove the password and all users for this company? It will then open without a password.")) return;
      clearCompanyAccess(activeCompanyId);
      refreshLocalUsers();
      toast.success("Password removed");
      return;
    }
    setSavingCompanyPwd(true);
    try {
      const owner = listCompanyUsers(activeCompanyId).find((u) => u.name.toLowerCase() === OWNER_NAME.toLowerCase());
      await upsertCompanyUser(activeCompanyId, OWNER_NAME, owner?.role ?? "admin", newCompanyPwd);
      toast.success(hasCompanyPwd ? "Password changed" : "Password set");
      setNewCompanyPwd("");
      refreshLocalUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save password");
    } finally {
      setSavingCompanyPwd(false);
    }
  };

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const { offlineDb } = await import("@/lib/offline/db");
      const local = await offlineDb.cache_company_settings.where("company_id").equals(activeCompanyId).first();
      if (local) {
        setSettings((cur) => {
          const merged: any = { ...cur };
          for (const k of Object.keys(cur)) if (local[k] !== undefined && local[k] !== null) merged[k] = local[k];
          return merged;
        });
        if (typeof local.einvoice_enabled === "boolean") setEiEnabled(local.einvoice_enabled);
        if (typeof local.ewaybill_enabled === "boolean") setEwbEnabled(local.ewaybill_enabled);
      }
    })();
  }, [activeCompanyId]);

  const addLocalUser = async () => {
    if (!activeCompanyId) return;
    if (listCompanyUsers(activeCompanyId).some((u) => u.name.toLowerCase() === inviteEmail.trim().toLowerCase())) {
      toast.error("A user with this name already exists. Use Reset password instead.");
      return;
    }
    try {
      const firstUser = listCompanyUsers(activeCompanyId).length === 0;
      await upsertCompanyUser(activeCompanyId, inviteEmail, firstUser ? "admin" : inviteRole, newUserPwd);
      toast.success(firstUser ? "User added as Admin (first user)" : "User added");
      setInviteEmail("");
      setNewUserPwd("");
      refreshLocalUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add user");
    }
  };

  const resetLocalPwd = async (userId: string, name: string) => {
    if (!activeCompanyId) return;
    const pwd = window.prompt(`New password for ${name} (min 4 characters):`);
    if (pwd == null) return;
    try {
      await resetUserPassword(activeCompanyId, userId, pwd);
      toast.success(`Password reset for ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset password");
    }
  };

  const updateRole = (userId: string, role: Member["role"]) => {
    if (!activeCompanyId) return;
    try {
      setUserRole(activeCompanyId, userId, role);
      toast.success("Role updated");
      refreshLocalUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
    }
  };

  const removeMember = (userId: string) => {
    if (!activeCompanyId) return;
    const list = listCompanyUsers(activeCompanyId);
    const target = list.find((u) => u.id === userId);
    if (target?.role === "admin" && list.filter((u) => u.role === "admin").length === 1 && list.length > 1) {
      toast.error("At least one admin is required");
      return;
    }
    if (!confirm("Remove this user from the company?")) return;
    removeCompanyUser(activeCompanyId, userId);
    toast.success("Removed");
    refreshLocalUsers();
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
      const { assertPreRestoreSnapshotOrConfirm } = await import("@/lib/restore-safety");
      const proceed = await assertPreRestoreSnapshotOrConfirm(activeCompanyId, targetName);
      if (!proceed) { toast.info("Restore cancelled."); return; }
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

  // `onlyOverrides`: single switches save just their own value, so unsaved
  // edits in other sections aren't written by accident.
  const saveSettings = async (overrides: Partial<Settings> = {}, onlyOverrides = Object.keys(overrides).length > 0) => {
    if (!activeCompanyId) return;
    setSavingSettings(true);
    const next = { ...settings, ...overrides };
    try {
      // Settings are business data: keep them in the local store on this device.
      const { offlineDb } = await import("@/lib/offline/db");
      const now = new Date().toISOString();
      const existing = await offlineDb.cache_company_settings.where("company_id").equals(activeCompanyId).first();
      if (existing) {
        await offlineDb.cache_company_settings.update(existing.id, { ...(onlyOverrides ? overrides : next), updated_at: now });
      } else {
        await offlineDb.cache_company_settings.put({ id: activeCompanyId, company_id: activeCompanyId, ...(onlyOverrides ? overrides : next), updated_at: now });
      }
      setSettings((cur) => ({ ...cur, ...(onlyOverrides ? overrides : next) }));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
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
      <ConnectAccountCard />


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
        <CardHeader><CardTitle className="text-base">Rollback to previous version</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If a recent update is causing issues in your environment (e.g. Windows 7 compatibility), 
            you can view instructions on how to revert to the version you were using before.
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              const { getVersionHistory } = await import("@/lib/update-safety");
              const hist = getVersionHistory();
              if (hist.length > 1) {
                const prev = hist[hist.length - 2].version;
                const now = hist[hist.length - 1].version;
                localStorage.setItem("ym_rollback_offer", JSON.stringify({
                  fromVersion: prev,
                  toVersion: now,
                  offeredAt: new Date().toISOString()
                }));
                window.location.reload();
              } else {
                toast.info("No previous version history found on this device.");
              }
            }}
          >
            <History className="mr-2 h-4 w-4" /> View rollback instructions
          </Button>
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
        <CardHeader><CardTitle className="text-base">App Notifications & Reminders</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Show notifications regarding GST returns, TDS deposits, and payment deadlines.
              </p>
            </div>
            <Switch
              checked={settings.reminders_enabled}
              onCheckedChange={(v) => saveSettings({ reminders_enabled: v })}
              disabled={savingSettings}
            />
          </div>

          {settings.reminders_enabled && (
            <div className="flex items-center justify-between border-t pt-4">
              <div className="space-y-0.5">
                <Label>Audit Case Reminders</Label>
                <p className="text-xs text-muted-foreground">
                  Receive advanced reminders for companies requiring a Tax Audit.
                  (Unregistered dealers or non-audit cases will not receive these).
                </p>
              </div>
              <Switch
                checked={settings.audit_case_reminders}
                onCheckedChange={(v) => saveSettings({ audit_case_reminders: v })}
                disabled={savingSettings}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">GST Compliance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>GSTIN Verification Interval</Label>
              <p className="text-xs text-muted-foreground">
                Frequency at which the app prompts to re-verify the company GSTIN.
              </p>
            </div>
            <Select
              value={settings.gst_check_interval}
              onValueChange={(v: any) => saveSettings({ gst_check_interval: v })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Every edit (Always)</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="half_yearly">Six Months</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        <CardHeader><CardTitle className="text-base">Voucher numbering &amp; sales cycle</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Choose the numbering format per voucher type (prefix, financial year, month,
            zero padding, yearly/monthly restart) and tick which sales-cycle documents you
            raise — quotation, sales order, delivery challan.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/app/settings/numbering" })}>
            Configure
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
          <Button onClick={() => saveSettings()} disabled={savingSettings || !isAdmin}>
            <Save className="mr-2 h-4 w-4" /> {savingSettings ? t("settings.invoice.saving") : t("settings.invoice.save")}
          </Button>
        </CardContent>
      </Card>

      <UpiQrSettingsCard companyId={activeCompanyId} />

      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.users")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[160px] space-y-1.5">
                <Label>Name</Label>
                <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="User name" />
              </div>
              <div className="flex-1 min-w-[160px] space-y-1.5">
                <Label>Password</Label>
                <Input type="password" autoComplete="new-password" value={newUserPwd} onChange={(e) => setNewUserPwd(e.target.value)} placeholder="Min 4 characters" />
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
              <Button onClick={addLocalUser}><UserPlus className="mr-2 h-4 w-4" /> Add user</Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-[220px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {localUsers.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select value={m.role} onValueChange={(v) => updateRole(m.id, v as Member["role"])}>
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
                    <TableCell className="space-x-1">
                      <Button variant="outline" size="sm" onClick={() => resetLocalPwd(m.id, m.name)}>Reset password</Button>
                      <Button variant="ghost" size="sm" onClick={() => removeMember(m.id)}>Remove</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Users and passwords are saved only on this computer. When a company has users, opening it asks you to pick your name and enter your password.
          </p>
        </CardContent>
      </Card>

      {isAdmin && activeMembership?.companies.gst_registered && (
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
            <Button onClick={() => saveSettings({ einvoice_enabled: eiEnabled, ewaybill_enabled: ewbEnabled } as any, true)} disabled={savingSetu || savingSettings}>
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
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Delete scope</Label>
                      <RadioGroup
                        value={deleteScope}
                        onValueChange={(v) => {
                          const next = v === "local_and_remote" ? "local_and_remote" : "local";
                          setDeleteScope(next);
                          try { window.localStorage.setItem("ym_delete_company_scope", next); } catch { /* ignore */ }
                        }}
                        className="gap-2"
                      >
                        <label className="flex items-start gap-2 rounded-md border border-border/60 p-2 cursor-pointer">
                          <RadioGroupItem value="local" id="scope-local" className="mt-0.5" />
                          <div className="text-sm">
                            <div className="font-medium">This device only</div>
                            <div className="text-xs text-muted-foreground">
                              Removes the company from local storage. Any copy on your account or other devices is left untouched.
                            </div>
                          </div>
                        </label>
                        <label className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer ${isLocalOnlyMode() ? "opacity-60" : "border-destructive/50"}`}>
                          <RadioGroupItem value="local_and_remote" id="scope-remote" className="mt-0.5" disabled={isLocalOnlyMode()} />
                          <div className="text-sm">
                            <div className="font-medium">This device + remote account</div>
                            <div className="text-xs text-muted-foreground">
                              {isLocalOnlyMode()
                                ? "Unavailable — local-only mode is on, no data is stored on our servers."
                                : "Also deletes the company from your cloud account. All other devices linked to this account will lose it on their next sync."}
                            </div>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>

                    {deleteScope === "local_and_remote" && !isLocalOnlyMode() && (
                      <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5" /> Server data will be removed
                        </div>
                        <div className="mt-1 text-destructive/90">
                          This deletes the company from the shared account on our servers. Team members and other devices will no longer see it. This action cannot be undone.
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="delete-confirm">Type company name to confirm</Label>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder={activeMembership?.companies.name ?? ""}
                        autoComplete="off"
                      />
                    </div>
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
                        const wantsRemote = deleteScope === "local_and_remote" && !isLocalOnlyMode();
                        if (wantsRemote) {
                          const ok = window.confirm(
                            `Final warning: this will also delete "${activeMembership?.companies.name}" from your cloud account and every device linked to it. Continue?`,
                          );
                          if (!ok) return;
                        }
                        setDeleting(true);
                        try {
                          const { purgeCompany } = await import("@/lib/recovery/purge-company");
                          const r = await purgeCompany(activeCompanyId);
                          if (wantsRemote) {
                            const { error } = await supabase.from("companies").delete().eq("id", activeCompanyId);
                            if (error) {
                              toast.warning(`Local delete done. Remote delete failed: ${error.message}`);
                            } else {
                              toast.success(`Deleted "${r.companyName}" locally and from your account — ${r.rowsDeleted} rows removed`);
                            }
                          } else {
                            toast.success(`Deleted "${r.companyName}" from this device — ${r.rowsDeleted} rows removed`);
                          }
                          setDeleteOpen(false);
                          setDeleteConfirm("");
                          if (typeof window !== "undefined") {
                            localStorage.removeItem("ym_active_company_id");
                          }
                          await refreshCompanies();
                          navigate({ to: "/app/companies" });
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to delete company");
                        } finally {
                          setDeleting(false);
                        }
                      }}
                    >
                      {deleting ? "Deleting…" : deleteScope === "local_and_remote" && !isLocalOnlyMode() ? "Delete locally + remotely" : "Delete on this device"}
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
