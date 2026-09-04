import { toTitleCaseOnType } from "@/lib/text-case";
import { createFileRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Check, Plus, Pencil, Upload, LayoutGrid, List as ListIcon, CheckCircle2, Users, CloudDownload, FileUp, ChevronLeft, ChevronRight } from "lucide-react";
import { UserManagementDialog } from "@/components/UserManagementDialog";
import { GstinPortalButton } from "@/components/GstinPortalButton";
import { GstinInlineError } from "@/components/GstinInlineError";
import { RestoreFromCloudDialog } from "@/components/RestoreFromCloudDialog";
import { RestoreFromFileDialog } from "@/components/RestoreFromFileDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";
import { INDIAN_STATES } from "@/lib/constants";
import { ENTITY_STATUSES, getEntityFeatures, getEntityMeta, type EntityStatus } from "@/lib/entity-status";
import { companyFormSchema as schema } from "@/lib/schemas/company";
import { EntityMembersEditor } from "@/components/companies/EntityMembersEditor";
import { NceOnboardingDialog } from "@/components/companies/NceOnboardingDialog";
import { classifyNceLevel, NCE_LEVEL_LABEL } from "@/lib/nce-classification";
import { CURRENCIES } from "@/lib/currency";
import { DATE_FORMATS } from "@/lib/date-format";
import { isCompanyUnlocked, markCompanyUnlocked } from "@/lib/tech-user";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { isOnlineNow } from "@/lib/offline/online-status";

export const Route = createFileRoute("/app/companies")({
  head: () => ({ meta: [{ title: "Companies — Your Mehtaji" }] }),
  component: CompaniesPage,
});

interface FormState {
  name: string;
  entity_status: EntityStatus;
  cin: string;
  share_capital_lakhs: string;
  corpus_fund_lakhs: string;
  gstin: string;
  pan: string;
  state: string;
  state_code: string;
  address: string;
  email: string;
  phone: string;
  financial_year_start: string;
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_branch: string;
  logo_url: string | null;
  gst_registered: boolean;
  gst_filing_frequency: "monthly" | "quarterly" | "iff";
  inventory_enabled: boolean;
  annual_turnover_lakhs: string;
  borrowings_lakhs: string;
  nce_level_override: boolean;
  nce_level: 1 | 2 | 3 | null;
  presumptive_scheme: "none" | "44ad" | "44ada";
  presumptive_mode: "digital" | "cash" | "professional";
  trial_local: boolean;
  currency_code: string;
  date_format: "dd-mm-yyyy" | "dd/mm/yyyy" | "mm-dd-yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "dd-mmm-yyyy";
}

const empty: FormState = {
  name: "",
  entity_status: "individual",
  cin: "",
  share_capital_lakhs: "",
  corpus_fund_lakhs: "",
  gstin: "",
  pan: "",
  state: "",
  state_code: "",
  address: "",
  email: "",
  phone: "",
  financial_year_start: `${new Date().getFullYear()}-04-01`,
  bank_name: "",
  bank_account_no: "",
  bank_ifsc: "",
  bank_branch: "",
  logo_url: null,
  gst_registered: false,
  gst_filing_frequency: "monthly",
  inventory_enabled: true,
  annual_turnover_lakhs: "",
  borrowings_lakhs: "",
  nce_level_override: false,
  nce_level: null,
  presumptive_scheme: "none",
  presumptive_mode: "cash",
  trial_local: true,
  currency_code: "INR",
  date_format: "dd-mm-yyyy",
};

function CompaniesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [fyLocks, setFyLocks] = useState<Record<string, boolean>>({});
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFileOpen, setRestoreFileOpen] = useState(false);
  const [nceWizard, setNceWizard] = useState<{ id: string; entity: EntityStatus } | null>(null);

  // Per-company selected FY state (year integer e.g., 2025, 2026)
  const [selectedYears, setSelectedYears] = useState<Record<string, number>>({});

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const m of memberships) {
      const start = m.companies.financial_year_start;
      const y = start ? new Date(start).getFullYear() : new Date().getFullYear();
      init[m.company_id] = y;
    }
    setSelectedYears((prev) => ({ ...init, ...prev }));
  }, [memberships]);

  // Handle FY Stepping with Automatic New Year Provisioning
  const handleStepYear = async (companyId: string, companyName: string, direction: -1 | 1, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = selectedYears[companyId] ?? new Date().getFullYear();
    const nextYear = current + direction;

    setSelectedYears((prev) => ({ ...prev, [companyId]: nextYear }));

    const nextStart = `${nextYear}-04-01`;
    const nextEnd = `${nextYear + 1}-03-31`;

    // Persist active FY range for reports/vouchers
    try {
      localStorage.setItem(`ym_active_fy_start_${companyId}`, nextStart);
      localStorage.setItem(`ym_active_fy_end_${companyId}`, nextEnd);
    } catch { /* non-fatal */ }

    // When advancing beyond the current date, automatically provision the new FY
    if (direction === 1) {
      const targetCompany = memberships.find((m) => m.company_id === companyId);
      const companyFyStart = targetCompany?.companies?.financial_year_start
        ? new Date(targetCompany.companies.financial_year_start).getFullYear()
        : new Date().getFullYear();

      if (nextYear > companyFyStart) {
        toast.info(`Created FY ${nextYear}-${String(nextYear + 1).slice(-2)}`, {
          description: `Initialized new financial year for ${companyName}.`,
        });

        // Mirror the new year to local database & cloud
        try {
          const { offlineDb } = await import("@/lib/offline/db");
          const existing = await offlineDb.cache_companies.get(companyId);
          if (existing) {
            await offlineDb.cache_companies.put({
              ...existing,
              financial_year_start: nextStart,
              updated_at: new Date().toISOString(),
            });
          }
          if (isOnlineNow() && !isLocalOnlyMode()) {
            await supabase.from("companies").update({ financial_year_start: nextStart }).eq("id", companyId);
          }
        } catch (err) {
          console.warn("FY auto-provision background error:", err);
        }
      }
    }
  };

  useEffect(() => {
    if (memberships.length === 0) {
      setFyLocks({});
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = memberships.map((m) => m.company_id);
      const { data } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            in: (col: string, vals: string[]) => {
              eq: (col: string, val: unknown) => {
                eq: (col: string, val: unknown) => Promise<{
                  data: { company_id: string; period_start: string }[] | null;
                }>;
              };
            };
          };
        };
      })
        .from("period_locks")
        .select("company_id, period_start")
        .in("company_id", ids)
        .eq("return_type", "fy_close")
        .eq("is_active", true);
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      for (const m of memberships) {
        const fyStart = m.companies.financial_year_start;
        if (!fyStart) continue;
        const match = (data ?? []).find(
          (r) => r.company_id === m.company_id && r.period_start === fyStart,
        );
        if (match) map[m.company_id] = true;
      }
      setFyLocks(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [memberships]);

  const location = useLocation();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(location.searchStr ?? window.location.search);
    if (sp.get("new") === "1") {
      setEditingId(null);
      setForm(empty);
      setOpen(true);
      navigate({ to: "/app/companies", search: {} as never, replace: true });
      return;
    }
    const editId = sp.get("edit");
    if (editId) {
      openEdit(editId);
      navigate({ to: "/app/companies", search: {} as never, replace: true });
    }
  }, [location.searchStr]);

  const openNew = () => {
    setEditingId(null);
    setForm(empty);
    setOpen(true);
  };

  const openEdit = async (id: string) => {
    let data: any = null;
    let cloudErrMsg: string | null = null;
    try {
      const res = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
      if (res.error) cloudErrMsg = res.error.message;
      if (res.data) data = res.data;
    } catch (e) {
      cloudErrMsg = e instanceof Error ? e.message : String(e);
    }
    if (!data) {
      try {
        const { offlineDb } = await import("@/lib/offline/db");
        const local = await offlineDb.cache_companies.get(id);
        if (local) data = local;
      } catch { /* ignore */ }
    }
    if (!data) {
      toast.error(cloudErrMsg || "Failed to load company");
      return;
    }
    setEditingId(id);
    setForm({
      name: data.name,
      entity_status: ((data as { entity_status?: EntityStatus }).entity_status ?? "individual"),
      cin: (data as { cin?: string | null }).cin ?? "",
      share_capital_lakhs: (data as { share_capital_paise?: number }).share_capital_paise
        ? String(((data as { share_capital_paise: number }).share_capital_paise) / 100 / 100000) : "",
      corpus_fund_lakhs: (data as { corpus_fund_paise?: number }).corpus_fund_paise
        ? String(((data as { corpus_fund_paise: number }).corpus_fund_paise) / 100 / 100000) : "",
      gstin: data.gstin ?? "",
      pan: data.pan ?? "",
      state: data.state ?? "",
      state_code: data.state_code ?? "",
      address: data.address ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      financial_year_start: data.financial_year_start ?? `${new Date().getFullYear()}-04-01`,
      bank_name: data.bank_name ?? "",
      bank_account_no: data.bank_account_no ?? "",
      bank_ifsc: data.bank_ifsc ?? "",
      bank_branch: data.bank_branch ?? "",
      logo_url: data.logo_url ?? null,
      gst_registered: data.gst_registered ?? (data.gstin ? true : false),
      gst_filing_frequency: (data.gst_filing_frequency ?? "monthly") as "monthly" | "quarterly" | "iff",
      inventory_enabled: data.inventory_enabled ?? true,
      annual_turnover_lakhs: data.annual_turnover_paise ? String(data.annual_turnover_paise / 100 / 100000) : "",
      borrowings_lakhs: (data as { borrowings_paise?: number }).borrowings_paise
        ? String(((data as { borrowings_paise: number }).borrowings_paise) / 100 / 100000) : "",
      nce_level_override: !!(data as { nce_level_override?: boolean }).nce_level_override,
      nce_level: ((data as { nce_level?: 1 | 2 | 3 | null }).nce_level ?? null),
      presumptive_scheme: (((data as { presumptive_scheme?: "none" | "44ad" | "44ada" }).presumptive_scheme) ?? "none"),
      presumptive_mode: (((data as { presumptive_mode?: "digital" | "cash" | "professional" }).presumptive_mode) ?? "cash"),
      trial_local: ((data as { mode?: string }).mode ?? "trial_local") === "trial_local",
      currency_code: ((data as { currency_code?: string }).currency_code) ?? "INR",
      date_format: (((data as { date_format?: FormState["date_format"] }).date_format) ?? "dd-mm-yyyy"),
    });
    setOpen(true);
  };

  const onUploadLogo = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("company-logos").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("company-logos").getPublicUrl(path);
      setForm((f) => ({ ...f, logo_url: pub.publicUrl }));
      toast.success("Logo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((i) => {
        const field = i.path.join(".") || "form";
        const msg = i.message && i.message !== "Invalid input" ? i.message : `${field} is invalid`;
        return `${field}: ${msg}`;
      });
      toast.error("Please fix the highlighted fields", {
        description: issues.join(" • "),
        duration: 8000,
      });
      return;
    }
    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData.session?.user?.id ?? user?.id;
    if (!currentUserId) {
      setSubmitting(false);
      toast.error("Session expired. Sign in again.");
      return;
    }

    const payload = {
      name: parsed.data.name,
      entity_status: parsed.data.entity_status,
      cin: parsed.data.entity_status === "pvt_ltd" ? (parsed.data.cin?.toUpperCase() || null) : null,
      share_capital_paise: parsed.data.entity_status === "pvt_ltd"
        ? Math.round((parseFloat(parsed.data.share_capital_lakhs ?? "") || 0) * 100000 * 100) : 0,
      corpus_fund_paise: parsed.data.entity_status === "trust"
        ? Math.round((parseFloat(parsed.data.corpus_fund_lakhs ?? "") || 0) * 100000 * 100) : 0,
      gstin: parsed.data.gst_registered ? (parsed.data.gstin || null) : null,
      pan: parsed.data.pan || null,
      state: parsed.data.state || null,
      state_code: parsed.data.state_code || null,
      address: parsed.data.address || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      financial_year_start: parsed.data.financial_year_start || `${new Date().getFullYear()}-04-01`,
      bank_name: parsed.data.bank_name || null,
      bank_account_no: parsed.data.bank_account_no || null,
      bank_ifsc: parsed.data.bank_ifsc || null,
      bank_branch: parsed.data.bank_branch || null,
      logo_url: form.logo_url,
      gst_registered: parsed.data.gst_registered,
      gst_filing_frequency: parsed.data.gst_registered ? parsed.data.gst_filing_frequency : "monthly",
      inventory_enabled: parsed.data.inventory_enabled,
      annual_turnover_paise: Math.round((parseFloat(parsed.data.annual_turnover_lakhs ?? "") || 0) * 100000 * 100),
      borrowings_paise: Math.round((parseFloat(parsed.data.borrowings_lakhs ?? "") || 0) * 100000 * 100),
      nce_level: parsed.data.nce_level_override ? (parsed.data.nce_level ?? null) : null,
      nce_level_override: !!parsed.data.nce_level_override,
      presumptive_scheme: parsed.data.presumptive_scheme ?? "none",
      presumptive_mode: parsed.data.presumptive_scheme === "44ada"
        ? "professional"
        : (parsed.data.presumptive_mode ?? "cash"),
      mode: "trial_local",
      currency_code: parsed.data.currency_code || "INR",
      date_format: parsed.data.date_format || "dd-mm-yyyy",
    };

    let savedId: string | null = null;
    try {
      if (editingId) {
        const { error } = await supabase.from("companies").update(payload).eq("id", editingId);
        if (error && !isLocalOnlyMode()) { setSubmitting(false); toast.error(error.message); return; }
        try {
          const { offlineDb } = await import("@/lib/offline/db");
          const existing = (await offlineDb.cache_companies.get(editingId)) || { id: editingId };
          await offlineDb.cache_companies.put({ ...existing, ...payload, id: editingId, updated_at: new Date().toISOString() });
          await offlineDb.companies.put({ id: editingId, name: payload.name, has_password: (existing as any).has_password ?? false });
        } catch { /* non-fatal */ }
        savedId = editingId;
        toast.success("Company updated");
      } else {
        const activeStaffId = typeof window !== "undefined" ? localStorage.getItem("ym_active_staff_id") : null;
        const newId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const { error } = await supabase
          .from("companies")
          .insert({ id: newId, ...payload, created_by: currentUserId, owner_app_user_id: activeStaffId });
        if (error) { setSubmitting(false); toast.error(error.message); return; }
        await supabase.from("company_members").upsert(
          { company_id: newId, user_id: currentUserId, role: "admin" },
          { onConflict: "company_id,user_id", ignoreDuplicates: true },
        );
        savedId = newId;
        setActiveCompanyId(newId);
        toast.success("Company created");
      }
    } catch (err: any) {
      setSubmitting(false);
      toast.error(err?.message ?? "Failed to save company");
      return;
    }
    setSubmitting(false);
    await refresh();
    const wasCreate = !editingId;
    const createdId = savedId;
    const createdEntity = parsed.data.entity_status;
    setForm(empty);
    setEditingId(null);
    setOpen(false);
    if (wasCreate && createdId) {
      const already = (() => { try { return localStorage.getItem(`ym_nce_onboarded_${createdId}`) === "1"; } catch { return false; } })();
      const turnoverEntered = (parseFloat(parsed.data.annual_turnover_lakhs ?? "") || 0) > 0;
      if (!already && !turnoverEntered) {
        setNceWizard({ id: createdId, entity: createdEntity });
      }
    }
  };

  const onStateCodeChange = (code: string) => {
    const state = INDIAN_STATES.find((s) => s.code === code);
    setForm((f) => ({ ...f, state_code: code, state: state?.name ?? f.state }));
  };

  const openMembershipCompany = async (companyId: string) => {
    const chosenYear = selectedYears[companyId];
    if (chosenYear) {
      const customStart = `${chosenYear}-04-01`;
      const customEnd = `${chosenYear + 1}-03-31`;
      try {
        localStorage.setItem(`ym_active_fy_start_${companyId}`, customStart);
        localStorage.setItem(`ym_active_fy_end_${companyId}`, customEnd);
      } catch { /* ignore */ }
    }

    if (isCompanyUnlocked(companyId)) {
      setActiveCompanyId(companyId);
      navigate({ to: "/app" });
      return;
    }

    let hasPassword = false;
    try {
      const { offlineDb } = await import("@/lib/offline/db");
      const local = await offlineDb.companies.get(companyId).catch(() => null);
      if (local) {
        hasPassword = Boolean(local.has_password);
      } else if (!isLocalOnlyMode() && isOnlineNow()) {
        const { data } = await supabase
          .from("companies_picker")
          .select("has_password")
          .eq("id", companyId)
          .maybeSingle();
        hasPassword = Boolean(data?.has_password);
      }
    } catch { /* best-effort */ }

    if (!hasPassword) {
      markCompanyUnlocked(companyId);
      setActiveCompanyId(companyId);
      navigate({ to: "/app" });
      return;
    }

    setActiveCompanyId(companyId);
    navigate({ to: "/" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Each company has its own books. Switch companies from the top bar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setUserMgmtOpen(true)}>
            <Users className="mr-2 h-4 w-4" /> Manage users
          </Button>
          <Button variant="outline" onClick={() => setRestoreFileOpen(true)}>
            <FileUp className="mr-2 h-4 w-4" /> Restore from file
          </Button>
          <Button variant="outline" onClick={() => setRestoreOpen(true)}>
            <CloudDownload className="mr-2 h-4 w-4" /> Restore from cloud
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" /> New company
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit company" : "Create a new company"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Company name *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: toTitleCaseOnType(e.target.value) })} required />
                  </div>
                  <div className="space-y-1.5 md:col-span-2 rounded-md border bg-muted/30 p-3">
                    <Label className="text-sm font-semibold">Entity Status</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Determines which fields, ledger groups and report formats apply.
                    </p>
                    <Select
                      value={form.entity_status}
                      onValueChange={(v) => setForm({ ...form, entity_status: v as EntityStatus })}
                    >
                      <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ENTITY_STATUSES.map((e) => {
                          const Icon = e.icon;
                          return (
                            <SelectItem key={e.value} value={e.value}>
                              <span className="inline-flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5" /> {e.label}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>GSTIN</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        value={form.gstin}
                        onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                        maxLength={15}
                        disabled={!form.gst_registered}
                        placeholder={form.gst_registered ? "" : "Not applicable"}
                      />
                      <GstinPortalButton
                        companyId={editingId}
                        gstin={form.gstin}
                        disabled={!form.gst_registered}
                        onDataFetched={(d) => {
                          const g = ((d.gstin || form.gstin) || "").toUpperCase();
                          const pan = g.length >= 12 ? g.slice(2, 12) : "";
                          const code = g.slice(0, 2);
                          const stateMatch = INDIAN_STATES.find((s) => s.code === code);
                          const address = (d.address || "").replace(/\s+/g, " ").trim();
                          const nameFromGstin = (d.legalName || d.tradeName || "").trim();
                          setForm((f) => ({
                            ...f,
                            name: nameFromGstin && (!editingId || !f.name) ? nameFromGstin : (f.name || nameFromGstin),
                            gstin: g || f.gstin,
                            pan: pan || f.pan,
                            state_code: code || f.state_code,
                            state: stateMatch?.name || f.state,
                            address: address || f.address,
                            gst_registered: true,
                          }));
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>PAN</Label>
                    <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>State</Label>
                    <Select value={form.state_code} onValueChange={onStateCodeChange}>
                      <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                      <SelectContent>
                        {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Financial Year Start</Label>
                    <FyDatePicker value={form.financial_year_start} onChange={(v: string) => setForm({ ...form, financial_year_start: v })} unrestricted />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : editingId ? "Save changes" : "Create company"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No companies yet. Create your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setViewMode("grid")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <ListIcon className="h-3.5 w-3.5" /> List
            </button>
          </div>

          {viewMode === "grid" ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {memberships.map((m) => {
                const isActive = m.company_id === activeCompanyId;
                const defaultYear = m.companies.financial_year_start ? new Date(m.companies.financial_year_start).getFullYear() : new Date().getFullYear();
                const displayYear = selectedYears[m.company_id] ?? defaultYear;
                const fyLabel = `FY ${displayYear}-${String(displayYear + 1).slice(-2)}`;
                const meta = getEntityMeta((m.companies as { entity_status?: EntityStatus }).entity_status);
                const EntityIcon = meta.icon;

                return (
                  <div
                    key={m.company_id}
                    onClick={() => !isActive && openMembershipCompany(m.company_id)}
                    className={`group relative flex flex-col rounded-xl border bg-card p-5 transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "border-primary/60 bg-primary/[0.03] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                        : "hover:border-primary/40 hover:bg-muted/40 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold leading-snug text-card-foreground break-words">
                          {m.companies.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {m.role === "admin" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(m.company_id); }}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Edit company"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
                        {m.role}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <EntityIcon className="h-3 w-3" /> {meta.short}
                      </span>
                      {!m.companies.gst_registered && (
                        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          UNREG.
                        </span>
                      )}
                    </div>

                    <div className="mt-4 space-y-1.5 text-[12px]">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>GSTIN</span>
                        <span className="font-mono text-foreground">{m.companies.gstin ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>State</span>
                        <span className="text-foreground">
                          {m.companies.state ?? "—"}
                          {m.companies.state_code ? ` (${m.companies.state_code})` : ""}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Section: Interactive FY Stepper + Open Action */}
                    <div className="mt-auto pt-4 flex items-center gap-2">
                      <div
                        className="flex flex-1 items-center justify-between gap-1 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs font-mono font-medium text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* PREVIOUS YEAR BUTTON */}
                        <button
                          type="button"
                          onClick={(e) => handleStepYear(m.company_id, m.companies.name, -1, e)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all"
                          title="Previous Financial Year"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>

                        <span className="font-semibold select-none">{fyLabel}</span>

                        {/* NEXT YEAR BUTTON WITH AUTO-CREATION */}
                        <button
                          type="button"
                          onClick={(e) => handleStepYear(m.company_id, m.companies.name, 1, e)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all"
                          title="Next Financial Year (Auto-creates new FY)"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>

                        {fyLocks[m.company_id] ? (
                          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> Locked
                          </span>
                        ) : (
                          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Provisional
                          </span>
                        )}
                      </div>

                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                          <Check className="h-3.5 w-3.5" /> Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openMembershipCompany(m.company_id); }}
                          className="inline-flex items-center rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List View */
            <div className="space-y-3">
              {memberships.map((m) => {
                const isActive = m.company_id === activeCompanyId;
                const defaultYear = m.companies.financial_year_start ? new Date(m.companies.financial_year_start).getFullYear() : new Date().getFullYear();
                const displayYear = selectedYears[m.company_id] ?? defaultYear;
                const fyLabel = `FY ${displayYear}-${String(displayYear + 1).slice(-2)}`;
                const meta = getEntityMeta((m.companies as { entity_status?: EntityStatus }).entity_status);
                const EntityIcon = meta.icon;

                return (
                  <div
                    key={m.company_id}
                    onClick={() => !isActive && openMembershipCompany(m.company_id)}
                    className={`group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all duration-200 cursor-pointer sm:flex-row sm:items-center sm:gap-4 ${
                      isActive
                        ? "border-primary/60 bg-primary/[0.03] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                        : "hover:border-primary/40 hover:bg-muted/40 hover:shadow-md"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-card-foreground break-words">
                          {m.companies.name}
                        </h3>
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Check className="h-3 w-3" /> Active
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
                          {m.role}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <EntityIcon className="h-3 w-3" /> {meta.short}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground sm:shrink-0">
                      <div
                        className="flex items-center gap-1.5 font-mono text-foreground rounded border bg-muted/30 px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => handleStepYear(m.company_id, m.companies.name, -1, e)}
                          className="hover:text-primary"
                          title="Previous Year"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span>{fyLabel}</span>
                        <button
                          type="button"
                          onClick={(e) => handleStepYear(m.company_id, m.companies.name, 1, e)}
                          className="hover:text-primary"
                          title="Next Year (Auto-create)"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openMembershipCompany(m.company_id); }}
                          className="inline-flex items-center rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          Open
                        </button>
                      )}
                      {m.role === "admin" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(m.company_id); }}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Edit company"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <UserManagementDialog open={userMgmtOpen} onOpenChange={setUserMgmtOpen} />
      <RestoreFromCloudDialog open={restoreOpen} onOpenChange={setRestoreOpen} onComplete={() => refresh()} />
      <RestoreFromFileDialog
        open={restoreFileOpen}
        onOpenChange={setRestoreFileOpen}
        memberships={memberships.map((m) => ({ company_id: m.company_id, companies: { name: m.companies.name } }))}
        onDone={() => refresh()}
      />
      {nceWizard && (
        <NceOnboardingDialog
          open={!!nceWizard}
          onOpenChange={(v) => { if (!v) setNceWizard(null); }}
          companyId={nceWizard.id}
          entity={nceWizard.entity}
          onSaved={() => { void refresh(); }}
        />
      )}
    </div>
  );
}

function NceComplianceCard({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const turnoverPaise = Math.round((parseFloat(form.annual_turnover_lakhs || "0") || 0) * 100000 * 100);
  const borrowingsPaise = Math.round((parseFloat(form.borrowings_lakhs || "0") || 0) * 100000 * 100);
  const auto = classifyNceLevel({ entity: form.entity_status, turnoverPaise, borrowingsPaise });
  const effectiveLevel = form.nce_level_override && form.nce_level ? form.nce_level : auto.level;

  return (
    <div className="space-y-3 md:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label className="text-sm font-semibold">NCE Compliance (ICAI classification)</Label>
        {auto.isCorporate ? (
          <Badge variant="secondary">Corporate — Schedule III</Badge>
        ) : (
          <Badge>{NCE_LEVEL_LABEL[effectiveLevel]}</Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{auto.reason}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Outstanding Borrowings (₹ in Lakhs)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="e.g. 100 for ₹1 Cr"
            value={form.borrowings_lakhs}
            onChange={(e) => setForm({ ...form, borrowings_lakhs: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">Used with turnover to compute Level 1/2/3.</p>
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.nce_level_override}
              onChange={(e) => setForm({ ...form, nce_level_override: e.target.checked })}
            />
            Manually override Level
          </label>
          {form.nce_level_override && (
            <Select
              value={String(form.nce_level ?? auto.level)}
              onValueChange={(v) => setForm({ ...form, nce_level: parseInt(v, 10) as 1 | 2 | 3 })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Level 1 (Large)</SelectItem>
                <SelectItem value="2">Level 2 (Medium)</SelectItem>
                <SelectItem value="3">Level 3 (Small / MSME)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="border-t pt-3 space-y-1.5">
        <Label className="text-sm font-semibold">Presumptive Taxation</Label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Scheme</Label>
            <Select
              value={form.presumptive_scheme}
              onValueChange={(v) => setForm({ ...form, presumptive_scheme: v as FormState["presumptive_scheme"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (regular assessment)</SelectItem>
                <SelectItem value="44ad">§44AD — Small Business</SelectItem>
                <SelectItem value="44ada">§44ADA — Professional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.presumptive_scheme === "44ad" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Primary receipt mode</Label>
              <Select
                value={form.presumptive_mode}
                onValueChange={(v) => setForm({ ...form, presumptive_mode: v as FormState["presumptive_mode"] })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="digital">Digital / banking (6% deemed profit)</SelectItem>
                  <SelectItem value="cash">Cash (8% deemed profit)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
