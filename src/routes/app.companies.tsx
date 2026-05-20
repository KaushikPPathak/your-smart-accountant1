import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Check, Plus, Pencil, Upload, LayoutGrid, List as ListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CURRENCIES } from "@/lib/currency";
import { DATE_FORMATS } from "@/lib/date-format";

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
  trial_local: false,
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

  // Auto-open the "Create company" dialog when the URL carries ?new=1
  // (used by the sidebar Company flyout's "+ New company" button).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("new") === "1") {
      setEditingId(null);
      setForm(empty);
      setOpen(true);
    }
    const editId = sp.get("edit");
    if (editId) {
      openEdit(editId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(empty);
    setOpen(true);
  };

  const openEdit = async (id: string) => {
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
    if (error || !data) {
      toast.error(error?.message || "Failed to load company");
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
      trial_local: (data as { mode?: string }).mode === "trial_local",
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
      toast.error(parsed.error.issues[0].message);
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
      mode: parsed.data.trial_local ? "trial_local" : "normal",
      currency_code: parsed.data.currency_code || "INR",
      date_format: parsed.data.date_format || "dd-mm-yyyy",
    };

    if (editingId) {
      const { error } = await supabase.from("companies").update(payload).eq("id", editingId);
      setSubmitting(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Company updated");
    } else {
      const { data, error } = await supabase
        .from("companies")
        .insert({ ...payload, created_by: currentUserId })
        .select("id")
        .maybeSingle();
      setSubmitting(false);
      if (error || !data) { toast.error(error?.message ?? "Failed to create"); return; }
      setActiveCompanyId(data.id);
      toast.success("Company created");
    }
    await refresh();
    setForm(empty);
    setEditingId(null);
    setOpen(false);
  };

  const onStateCodeChange = (code: string) => {
    const state = INDIAN_STATES.find((s) => s.code === code);
    setForm((f) => ({ ...f, state_code: code, state: state?.name ?? f.state }));
  };

  const openMembershipCompany = (companyId: string) => {
    setActiveCompanyId(companyId);
    navigate({ to: "/app" });
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
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-2 rounded-md border bg-muted/30 p-3">
                  <Label className="text-sm font-semibold">Entity Status</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Determines which fields, ledger groups and report formats apply (Schedule III for Pvt Ltd, Income & Expenditure for Trust, etc.).
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
                  <p className="mt-2 text-[11px] text-muted-foreground italic">
                    {getEntityMeta(form.entity_status).description}
                  </p>
                  {(() => {
                    const f = getEntityFeatures(form.entity_status);
                    if (!f.showCIN && !f.showShareCapital && !f.showCorpusFund) return null;
                    return (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {f.showCIN && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">CIN</Label>
                            <Input
                              value={form.cin}
                              onChange={(e) => setForm({ ...form, cin: e.target.value.toUpperCase() })}
                              maxLength={21}
                              placeholder="U12345MH2020PTC123456"
                            />
                          </div>
                        )}
                        {f.showShareCapital && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Authorised Share Capital (₹ in Lakhs)</Label>
                            <Input type="number" step="0.01" value={form.share_capital_lakhs}
                              onChange={(e) => setForm({ ...form, share_capital_lakhs: e.target.value })} />
                          </div>
                        )}
                        {f.showCorpusFund && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Corpus Fund (₹ in Lakhs)</Label>
                            <Input type="number" step="0.01" value={form.corpus_fund_lakhs}
                              onChange={(e) => setForm({ ...form, corpus_fund_lakhs: e.target.value })} />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-1.5 md:col-span-2 rounded-md border bg-muted/30 p-3">
                  <Label className="text-sm font-semibold">GST Registration</Label>
                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="gst_reg"
                        checked={form.gst_registered === true}
                        onChange={() => setForm({ ...form, gst_registered: true })}
                      />
                      Registered Dealer
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="gst_reg"
                        checked={form.gst_registered === false}
                        onChange={() => setForm({ ...form, gst_registered: false, gstin: "" })}
                      />
                      Not Registered
                    </label>
                  </div>
                  {form.gst_registered && (
                    <div className="mt-3 space-y-1.5">
                      <Label className="text-xs">Return Filing Frequency</Label>
                      <Select
                        value={form.gst_filing_frequency}
                        onValueChange={(v) => setForm({ ...form, gst_filing_frequency: v as "monthly" | "quarterly" | "iff" })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly (GSTR-1 + GSTR-3B every month)</SelectItem>
                          <SelectItem value="quarterly">Quarterly (QRMP — GSTR-1 + 3B each quarter)</SelectItem>
                          <SelectItem value="iff">IFF (QRMP with monthly Invoice Furnishing Facility)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 md:col-span-2 rounded-md border bg-muted/30 p-3">
                  <Label className="text-sm font-semibold">Inventory</Label>
                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="inv_enabled"
                        checked={form.inventory_enabled === true}
                        onChange={() => setForm({ ...form, inventory_enabled: true })}
                      />
                      Maintain Inventory (Items / Stock)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="inv_enabled"
                        checked={form.inventory_enabled === false}
                        onChange={() => setForm({ ...form, inventory_enabled: false })}
                      />
                      Accounts Only (No Inventory)
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When off, Items / Stock and Stock Summary are hidden from the menu.
                  </p>
                  <div className="mt-3 space-y-1.5">
                    <Label className="text-xs">Annual Turnover (₹ in Lakhs)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 250 for ₹2.5 Cr"
                      value={form.annual_turnover_lakhs}
                      onChange={(e) => setForm({ ...form, annual_turnover_lakhs: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Determines HSN digits required: <strong>4-digit</strong> if &lt; ₹5 Cr, <strong>6-digit</strong> if ≥ ₹5 Cr.
                    </p>
                </div>
                <div className="space-y-1.5 md:col-span-2 rounded-md border bg-muted/30 p-3">
                  <Label className="text-sm font-semibold">Display Preferences</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Currency symbol and date layout used throughout reports, vouchers and lists for this company. Books are always kept in INR; only the display changes.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Currency</Label>
                      <Select
                        value={form.currency_code}
                        onValueChange={(v) => setForm({ ...form, currency_code: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-[320px]">
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{c.symbol}</span>
                                <span>{c.code}</span>
                                <span className="hidden text-xs text-muted-foreground sm:inline">— {c.name}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Date Format</Label>
                      <Select
                        value={form.date_format}
                        onValueChange={(v) => setForm({ ...form, date_format: v as FormState["date_format"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DATE_FORMATS.map((f) => (
                            <SelectItem key={f.code} value={f.code}>
                              <span className="flex items-center gap-2">
                                <span>{f.label}</span>
                                <span className="text-xs text-muted-foreground">— {f.sample}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                </div>
                <div className="space-y-1.5 md:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.trial_local}
                      onChange={(e) => setForm({ ...form, trial_local: e.target.checked })}
                    />
                    <div>
                      <div className="font-semibold">Trial books — keep a continuous local copy on this PC</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Marks this company as <strong>Trial / Local-only</strong>. Each time you close the
                        app (or click <em>Backup now</em>) a JSON + Excel snapshot is saved to your hard
                        disk under <code>Documents/YourMehtaji/Exports/&lt;Company&gt;/</code>. In a normal
                        browser tab the snapshots download to your Downloads folder.
                      </p>
                    </div>
                  </label>
                </div>
                <div className="space-y-1.5">
                  <Label>GSTIN</Label>
                  <Input
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                    maxLength={15}
                    disabled={!form.gst_registered}
                    placeholder={form.gst_registered ? "" : "Not applicable"}
                  />
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
                  <Input type="date" value={form.financial_year_start} onChange={(e) => setForm({ ...form, financial_year_start: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Address</Label>
                  <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Logo</Label>
                  <div className="flex items-center gap-3">
                    {form.logo_url && <img src={form.logo_url} alt="Logo" className="h-12 w-12 rounded border object-contain bg-white" />}
                    <Input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadLogo(f); }} />
                  </div>
                  {uploading && <p className="text-xs text-muted-foreground"><Upload className="inline h-3 w-3" /> Uploading…</p>}
                </div>
                <div className="md:col-span-2 mt-2 border-t pt-3 text-sm font-semibold text-muted-foreground">Bank Details</div>
                <div className="space-y-1.5">
                  <Label>Bank name</Label>
                  <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account no.</Label>
                  <Input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>IFSC</Label>
                  <Input value={form.bank_ifsc} onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Input value={form.bank_branch} onChange={(e) => setForm({ ...form, bank_branch: e.target.value })} />
                </div>
              </div>
              {editingId && getEntityFeatures(form.entity_status).membersTabLabel && (
                <EntityMembersEditor
                  companyId={editingId}
                  features={getEntityFeatures(form.entity_status)}
                />
              )}
              {!editingId && getEntityFeatures(form.entity_status).membersTabLabel && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Save the company first — you'll then be able to add {getEntityFeatures(form.entity_status).membersTabLabel} (PAN/DIN, share %, profit-sharing ratio, capital contribution) on edit.
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : editingId ? "Save changes" : "Create company"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
          {/* View toggle */}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setViewMode("grid")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              title="Grid view"
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
              title="List view"
            >
              <ListIcon className="h-3.5 w-3.5" /> List
            </button>
          </div>

          {viewMode === "grid" ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {memberships.map((m) => {
                const isActive = m.company_id === activeCompanyId;
                const fyStart = m.companies.financial_year_start;
                const fyYear = fyStart ? new Date(fyStart).getFullYear() : null;
                const fyLabel = fyYear ? `FY ${fyYear}-${String(fyYear + 1).slice(-2)}` : "—";
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
                    {/* Top Section: Name + Edit */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3
                          className="text-[15px] font-semibold leading-snug text-card-foreground break-words"
                          title={m.companies.name}
                        >
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

                    {/* Middle Section: Badges */}
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
                      {m.companies.trial_local && (
                        <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                          TRIAL
                        </span>
                      )}
                    </div>

                    {/* Metadata rows */}
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

                    {/* Bottom Section: FY + Action */}
                    <div className="mt-auto pt-4 flex items-center gap-2">
                      <div className="flex flex-1 items-center justify-center rounded-lg border bg-muted/40 px-3 py-2 text-xs font-mono font-medium text-foreground">
                        <span className="text-muted-foreground mr-1">&lt;</span>
                        {fyLabel}
                        <span className="text-muted-foreground ml-1">&gt;</span>
                      </div>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                          <Check className="h-3.5 w-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          Open
                        </span>
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
                const fyStart = m.companies.financial_year_start;
                const fyYear = fyStart ? new Date(fyStart).getFullYear() : null;
                const fyLabel = fyYear ? `FY ${fyYear}-${String(fyYear + 1).slice(-2)}` : "—";
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
                    {/* Name + badges */}
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
                        {!m.companies.gst_registered && (
                          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            UNREG.
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground sm:shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide">GSTIN</span>
                        <span className="font-mono text-foreground">{m.companies.gstin ?? "—"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide">State</span>
                        <span className="text-foreground">{m.companies.state ?? "—"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide">FY</span>
                        <span className="font-mono font-medium text-foreground">{fyLabel}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 sm:shrink-0">
                      {!isActive && (
                        <span className="inline-flex items-center rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          Open
                        </span>
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
    </div>
  );
}
