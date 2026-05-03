import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Check, Plus, Pencil, Upload } from "lucide-react";
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
import { ENTITY_STATUSES, getEntityFeatures, getEntityMeta, CIN_REGEX, type EntityStatus } from "@/lib/entity-status";
import { EntityMembersEditor } from "@/components/companies/EntityMembersEditor";

export const Route = createFileRoute("/app/companies")({
  head: () => ({ meta: [{ title: "Companies — Your Mehtaji" }] }),
  component: CompaniesPage,
});

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  entity_status: z.enum(["individual","huf","aop","pvt_ltd","registered_firm","trust"]),
  cin: z.string().trim().max(21).optional().or(z.literal("")),
  share_capital_lakhs: z.string().optional(),
  corpus_fund_lakhs: z.string().optional(),
  gstin: z
    .string()
    .trim()
    .max(15)
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN")
    .optional()
    .or(z.literal("")),
  pan: z.string().trim().max(10).optional().or(z.literal("")),
  state: z.string().trim().max(50).optional().or(z.literal("")),
  state_code: z.string().trim().max(3).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  email: z.string().trim().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  financial_year_start: z.string().optional(),
  bank_name: z.string().trim().max(100).optional().or(z.literal("")),
  bank_account_no: z.string().trim().max(30).optional().or(z.literal("")),
  bank_ifsc: z.string().trim().max(15).optional().or(z.literal("")),
  bank_branch: z.string().trim().max(100).optional().or(z.literal("")),
  gst_registered: z.boolean(),
  gst_filing_frequency: z.enum(["monthly", "quarterly", "iff"]),
  inventory_enabled: z.boolean(),
  annual_turnover_lakhs: z.string().optional(),
  trial_local: z.boolean(),
}).superRefine((val, ctx) => {
  if (val.entity_status === "pvt_ltd" && val.cin && !CIN_REGEX.test(val.cin.toUpperCase())) {
    ctx.addIssue({ code: "custom", path: ["cin"], message: "Invalid CIN (e.g. U12345MH2020PTC123456)" });
  }
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
};

function CompaniesPage() {
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [uploading, setUploading] = useState(false);

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberships.map((m) => {
            const isActive = m.company_id === activeCompanyId;
            return (
              <Card key={m.company_id} className={isActive ? "border-primary ring-1 ring-primary/30" : ""}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{m.companies.name}</CardTitle>
                    <Badge variant="secondary" className="mt-1 text-[10px] uppercase">{m.role}</Badge>
                  </div>
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>GSTIN</span><span className="font-mono">{m.companies.gstin ?? "—"}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>State</span><span>{m.companies.state ?? "—"}{m.companies.state_code ? ` (${m.companies.state_code})` : ""}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>FY Start</span><span>{m.companies.financial_year_start}</span></div>
                  <div className="flex gap-2 pt-2">
                    {isActive ? (
                      <Button variant="secondary" size="sm" className="flex-1" disabled><Check className="mr-2 h-4 w-4" /> Active</Button>
                    ) : (
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setActiveCompanyId(m.company_id)}>Switch</Button>
                    )}
                    {m.role === "admin" && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(m.company_id)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
