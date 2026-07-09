import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { GstinPortalButton } from "@/components/GstinPortalButton";
import { GstinInlineError } from "@/components/GstinInlineError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toTitleCaseOnType } from "@/lib/text-case";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import {
  INDIAN_STATES,
  LEDGER_TYPES,
  type LedgerTypeValue,
} from "@/lib/constants";
import {
  ACCOUNT_GROUPS,
  GROUP_BY_CODE,
  defaultGroupCodeForType,
  defaultLedgerTypeForGroup,
} from "@/lib/account-groups";
import { useAccountGroups, resolveGroupLabel, subgroupsFor } from "@/lib/account-groups-runtime";
import { EmptyState } from "@/components/EmptyState";
import { ledgerFormSchema as schema, GST_REGISTRATION_TYPES, MSME_CLASSIFICATIONS } from "@/lib/schemas/ledger";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { createLedger, updateLedger, deleteLedger } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

export const Route = createFileRoute("/app/ledgers")({
  head: () => ({ meta: [{ title: "Ledgers — Your Mehtaji" }] }),
  component: LedgersPage,
});

interface Ledger {
  id: string;
  name: string;
  type: LedgerTypeValue;
  group_code: string | null;
  subgroup_id: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  state_code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
  credit_limit_paise: number;
  credit_days: number;
  is_active: boolean;
  gst_registration_type: string | null;
  gst_treatment: string | null;
  msme_registered: boolean | null;
  msme_udyam_no: string | null;
  msme_classification: string | null;
}

type FormState = {
  name: string;
  type: string;
  group_code: string;
  subgroup_id: string;
  gstin: string;
  pan: string;
  state_code: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  opening_balance: string;
  opening_balance_is_debit: boolean;
  credit_limit: string;
  credit_days: string;
  gst_registration_type: string;
  msme_registered: boolean;
  msme_udyam_no: string;
  msme_classification: string;
};

const emptyForm: FormState = {
  name: "",
  type: "",
  group_code: "",
  subgroup_id: "",
  gstin: "",
  pan: "",
  state_code: "",
  state: "",
  address: "",
  phone: "",
  email: "",
  opening_balance: "",
  opening_balance_is_debit: true,
  credit_limit: "",
  credit_days: "",
  gst_registration_type: "regular",
  msme_registered: false,
  msme_udyam_no: "",
  msme_classification: "",
};

function LedgersPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { subgroups, overrides } = useAccountGroups();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const { view, setView } = useReportView("masters-ledgers");

  const load = async () => {
    if (!activeCompanyId) {
      setLedgers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { readLedgers } = await import("@/lib/offline/cache-read");
    const readAll = async () => {
      const rows = await readLedgers(activeCompanyId);
      setLedgers((rows ?? []) as unknown as Ledger[]);
    };
    // Local-first: render whatever's in the offline cache immediately so the
    // page works offline and reflects locally-created (not-yet-synced) rows.
    try { await readAll(); } catch { setLedgers([]); }
    // If online, pull cloud deltas into the cache and re-read.
    if (isOnlineNow()) {
      try {
        const { syncEssentialMasters } = await import("@/lib/offline/masters");
        await syncEssentialMasters(activeCompanyId);
        await readAll();
      } catch (err: any) {
        // Non-fatal; cache stays authoritative until network recovers.
        console.warn("Ledger cloud sync deferred:", err?.message ?? err);
      }
    }
    setLoading(false);
  };



  useEffect(() => {
    load();
  }, [activeCompanyId]);

  // AUTO-EXTRACT PAN & AUTO-POPULATE STATE CODE SYNCHRONOUSLY
  useEffect(() => {
    const cleanGstin = form.gstin.trim().toUpperCase();
    if (!cleanGstin) return;

    let updatedFields: Partial<FormState> = {};

    // 1. Auto-match state choice prefix
    if (cleanGstin.length >= 2) {
      const prefix = cleanGstin.substring(0, 2);
      const matchedState = INDIAN_STATES.find((s) => s.code === prefix);
      if (matchedState && form.state_code !== matchedState.code) {
        updatedFields.state_code = matchedState.code;
        updatedFields.state = matchedState.name;
      }
    }

    // 2. Extract 10-digit PAN format from positions 3 to 12
    if (cleanGstin.length >= 12) {
      const extractedPan = cleanGstin.substring(2, 12);
      if (form.pan !== extractedPan) {
        updatedFields.pan = extractedPan;
      }
    }

    if (Object.keys(updatedFields).length > 0) {
      setForm((prev) => ({ ...prev, ...updatedFields }));
    }
  }, [form.gstin]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ledgers;
    return ledgers.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.gstin ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").toLowerCase().includes(q),
    );
  }, [ledgers, search]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (l: Ledger) => {
    setEditing(l);
    setForm({
      name: l.name,
      type: l.type,
      group_code: l.group_code ?? defaultGroupCodeForType(l.type),
      subgroup_id: l.subgroup_id ?? "",
      gstin: l.gstin ?? "",
      pan: l.pan ?? "",
      state_code: l.state_code ?? "",
      state: l.state ?? "",
      address: l.address ?? "",
      phone: l.phone ?? "",
      email: l.email ?? "",
      opening_balance: l.opening_balance_paise
        ? String(paiseToRupees(l.opening_balance_paise))
        : "",
      opening_balance_is_debit: l.opening_balance_is_debit,
      credit_limit: l.credit_limit_paise ? String(paiseToRupees(l.credit_limit_paise)) : "",
      credit_days: l.credit_days ? String(l.credit_days) : "",
      gst_registration_type: l.gst_registration_type ?? l.gst_treatment ?? "regular",
      msme_registered: !!l.msme_registered,
      msme_udyam_no: l.msme_udyam_no ?? "",
      msme_classification: l.msme_classification ?? "",
    });
    setOpen(true);
  };

  const onStateCodeChange = (code: string) => {
    const state = INDIAN_STATES.find((s) => s.code === code);
    setForm((f) => ({ ...f, state_code: code, state: state?.name ?? f.state }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) {
      toast.error("Select a company first");
      return;
    }
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const ob = parseFloat(parsed.data.opening_balance ?? "");
    const cl = parseFloat(parsed.data.credit_limit ?? "");
    const cd = parseInt(parsed.data.credit_days ?? "");
    const groupCode = form.group_code || defaultGroupCodeForType(parsed.data.type as LedgerTypeValue);
    const payload = {
      company_id: activeCompanyId,
      name: parsed.data.name,
      type: parsed.data.type as LedgerTypeValue,
      group_code: groupCode,
      subgroup_id: form.subgroup_id || null,
      gstin: parsed.data.gstin || null,
      pan: parsed.data.pan || null,
      state: parsed.data.state || null,
      state_code: parsed.data.state_code || null,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      opening_balance_paise: isFinite(ob) ? rupeesToPaise(Math.abs(ob)) : 0,
      opening_balance_is_debit: parsed.data.opening_balance_is_debit,
      credit_limit_paise: isFinite(cl) ? rupeesToPaise(cl) : 0,
      credit_days: isFinite(cd) ? cd : 0,
      gst_registration_type: form.gst_registration_type || "regular",
      msme_registered: form.msme_registered,
      msme_udyam_no: form.msme_registered ? (form.msme_udyam_no.trim().toUpperCase() || null) : null,
      msme_classification: form.msme_registered ? (form.msme_classification || null) : null,
    };

    try {
      if (editing) {
        await updateLedger(editing.id, activeCompanyId, payload);
      } else {
        await createLedger(payload);
      }
    } catch (err) {
      setSubmitting(false);
      toast.error(err instanceof Error ? err.message : "Save failed");
      return;
    }
    setSubmitting(false);
    toast.success(
      isLocalOnlyMode()
        ? (editing ? "Ledger updated on this device" : "Ledger created on this device")
        : isOnlineNow()
          ? (editing ? "Ledger updated" : "Ledger created")
          : (editing ? "Ledger update saved on this device" : "Ledger saved on this device"),
    );
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
    load();
  };

  const onDelete = async (l: Ledger) => {
    if (!confirm(`Delete ledger "${l.name}"? This cannot be undone.`)) return;
    if (!activeCompanyId) return;
    try {
      await deleteLedger(l.id, activeCompanyId, l.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      return;
    }
    toast.success(isLocalOnlyMode() || !isOnlineNow() ? "Ledger deleted on this device" : "Ledger deleted");
    load();
  };

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ledgers / Parties</h1>
          <p className="text-sm text-muted-foreground">
            Customers, suppliers, banks, expense heads — anything that hits the books.
          </p>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" /> New ledger
              </Button>
            </DialogTrigger>
            <DialogContent
              className="max-w-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col p-0 gap-0"
              onPointerDownOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
            >
              <DialogHeader className="px-4 sm:px-6 pt-4 pb-2 border-b shrink-0">
                <DialogTitle className="text-base sm:text-lg">{editing ? "Edit ledger" : "Create new ledger"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto px-4 sm:px-6 py-4 flex-1 min-h-0">
                  
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="name">Ledger name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: toTitleCaseOnType(e.target.value) })}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="type">Type *</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v) => {
                        const newType = v as LedgerTypeValue;
                        const cur = form.group_code ? GROUP_BY_CODE[form.group_code] : undefined;
                        const stillValid = cur?.ledgerTypes.includes(newType);
                        setForm({
                          ...form,
                          type: v,
                          group_code: stillValid ? form.group_code : defaultGroupCodeForType(newType),
                        });
                      }}
                    >
                      <SelectTrigger id="type" className="bg-white">
                        <SelectValue placeholder="Select ledger type" />
                      </SelectTrigger>
                      <SelectContent>
                        {LEDGER_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="group_code">Group (Income-Tax / Schedule III) *</Label>
                    <Select
                      value={form.group_code}
                      onValueChange={(v) => {
                        const grp = GROUP_BY_CODE[v];
                        const compatible = grp && (grp.ledgerTypes.includes(form.type as LedgerTypeValue));
                        setForm({
                          ...form,
                          group_code: v,
                          subgroup_id: "",
                          type: compatible ? form.type : defaultLedgerTypeForGroup(v),
                        });
                      }}
                    >
                      <SelectTrigger id="group_code" className="bg-white">
                        <SelectValue placeholder="Select group" />
                      </SelectTrigger>
                      <SelectContent>
                        {(["BS_LIAB", "BS_ASSET", "TRADING", "PL"] as const).map((sec) => (
                          <div key={sec}>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground bg-slate-50/60 sticky top-0">
                              {sec === "BS_LIAB" ? "Sources of Funds (Liabilities)"
                                : sec === "BS_ASSET" ? "Application of Funds (Assets)"
                                : sec === "TRADING" ? "Trading Account"
                                : "Profit & Loss Account"}
                            </div>
                            {ACCOUNT_GROUPS.filter((g) => g.section === sec)
                              .sort((a, b) => a.order - b.order)
                              .map((g) => (
                                <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>
                              ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {form.group_code && subgroupsFor(form.group_code, subgroups).length > 0 && (
                    <div className="space-y-1 col-span-2">
                      <Label htmlFor="subgroup_id">Sub-group (optional)</Label>
                      <Select
                        value={form.subgroup_id || "__none__"}
                        onValueChange={(v) => setForm({ ...form, subgroup_id: v === "__none__" ? "" : v })}
                      >
                        <SelectTrigger id="subgroup_id" className="bg-white">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {subgroupsFor(form.group_code, subgroups).map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* SIDE-BY-SIDE NEIGHBORHOOD CONTAINER: GSTIN AND STATE COMBINATION */}
                  <div className="space-y-1 flex flex-col justify-end">
                    <Label htmlFor="gstin">GSTIN</Label>
                    <div className="flex items-center gap-2 w-full">
                      <Input
                        id="gstin"
                        value={form.gstin}
                        onChange={(e) =>
                          setForm({ ...form, gstin: e.target.value.toUpperCase().trim() })
                        }
                        maxLength={15}
                        placeholder="24AAAAA0000A1Z5"
                        className="font-mono uppercase tracking-wider flex-1"
                      />
                      <GstinPortalButton
                        gstin={form.gstin}
                        onDataFetched={(d) => {
                          setForm((prev) => ({
                            ...prev,
                            name: prev.name?.trim() ? prev.name : (d.legalName || d.tradeName || prev.name),
                            gstin: d.gstin || prev.gstin,
                            address: d.address && !prev.address?.trim() ? d.address : prev.address,
                            state_code:
                              prev.state_code ||
                              (d.gstin ? (INDIAN_STATES.find((s) => s.code === d.gstin.substring(0, 2))?.code ?? prev.state_code) : prev.state_code),
                          }));
                        }}
                      />
                    </div>
                    <GstinInlineError value={form.gstin} />
                  </div>

                  <div className="space-y-1 flex flex-col justify-end">
                    <Label htmlFor="state_code">State</Label>
                    <Select value={form.state_code} onValueChange={onStateCodeChange}>
                      <SelectTrigger id="state_code" className="bg-white">
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDIAN_STATES.map((s) => (
                          <SelectItem key={s.code} value={s.code}>
                            {s.code} — {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Visual spacer to align cleanly with the inline error height */}
                    <div className="h-4" />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      maxLength={20}
                      placeholder="Contact number"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      maxLength={255}
                      placeholder="email@domain.com"
                    />
                  </div>

                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="address">Address</Label>
                    <Textarea
                      id="address"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      maxLength={500}
                      rows={2}
                      placeholder="Registered business or delivery address"
                    />
                  </div>

                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <Label htmlFor="pan">PAN</Label>
                    <Input 
                      id="pan" 
                      value={form.pan} 
                      onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().trim() })} 
                      maxLength={10} 
                      placeholder="ABCDE1234F" 
                      className="font-mono bg-slate-50/50 text-slate-700"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 col-span-2 sm:col-span-1">
                    <div className="space-y-1 col-span-2">
                      <Label htmlFor="opening_balance">Opening balance (₹)</Label>
                      <Input
                        id="opening_balance"
                        type="number"
                        step="0.01"
                        value={form.opening_balance}
                        onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ob_type">Dr / Cr</Label>
                      <Select
                        value={form.opening_balance_is_debit ? "dr" : "cr"}
                        onValueChange={(v) => setForm({ ...form, opening_balance_is_debit: v === "dr" })}
                      >
                        <SelectTrigger id="ob_type" className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dr">Dr</SelectItem>
                          <SelectItem value="cr">Cr</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="credit_limit">Credit limit (₹)</Label>
                    <Input id="credit_limit" type="number" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="0.00" />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="credit_days">Credit days</Label>
                    <Input id="credit_days" type="number" value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: e.target.value })} placeholder="0" />
                  </div>

                  {(form.type === "sundry_debtor" || form.type === "sundry_creditor") && (
                    <>
                      <div className="col-span-2 mt-2 border-t pt-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Party details (GST &amp; MSME)
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Drives GST return sectioning (B2B / B2CL / SEZ / Export) and Sec 43B MSME payable ageing.
                        </p>
                      </div>

                      <div className="space-y-1 col-span-2 sm:col-span-1">
                        <Label htmlFor="gst_registration_type">GST registration type</Label>
                        <Select
                          value={form.gst_registration_type || "regular"}
                          onValueChange={(v) => setForm({ ...form, gst_registration_type: v })}
                        >
                          <SelectTrigger id="gst_registration_type" className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GST_REGISTRATION_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1 col-span-2 sm:col-span-1">
                        <Label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={form.msme_registered}
                            onChange={(e) => setForm({ ...form, msme_registered: e.target.checked })}
                          />
                          Registered under MSME (UDYAM)
                        </Label>
                        <p className="text-[11px] text-muted-foreground pl-6">
                          Enables 45-day payment ageing (Sec 43B(h)).
                        </p>
                      </div>

                      {form.msme_registered && (
                        <>
                          <div className="space-y-1 col-span-2 sm:col-span-1">
                            <Label htmlFor="msme_udyam_no">UDYAM registration no.</Label>
                            <Input
                              id="msme_udyam_no"
                              value={form.msme_udyam_no}
                              onChange={(e) => setForm({ ...form, msme_udyam_no: e.target.value.toUpperCase() })}
                              maxLength={19}
                              placeholder="UDYAM-XX-00-0000000"
                              className="font-mono uppercase"
                            />
                          </div>
                          <div className="space-y-1 col-span-2 sm:col-span-1">
                            <Label htmlFor="msme_classification">Classification</Label>
                            <Select
                              value={form.msme_classification || ""}
                              onValueChange={(v) => setForm({ ...form, msme_classification: v })}
                            >
                              <SelectTrigger id="msme_classification" className="bg-white">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {MSME_CLASSIFICATIONS.map((c) => (
                                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </>
                  )}

                </div>
                <DialogFooter className="px-4 sm:px-6 py-3 border-t shrink-0 bg-background gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm">
                    {submitting ? "Saving…" : editing ? "Save changes" : "Create ledger"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2 flex-wrap">
          <CardTitle className="text-base">All ledgers ({ledgers.length})</CardTitle>
          <div className="flex items-center gap-2">
            <ViewSwitcher view={view} onChange={setView} classicLabel="Table" />
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, GSTIN, phone…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={ledgers.length === 0 ? "No ledgers yet" : "No matches"}
              description={
                ledgers.length === 0
                  ? "Create customers, suppliers, banks and expense heads to start booking entries."
                  : "Try a different search term."
              }
            />
          ) : view === "grid" ? (
            <div className="p-3">
              <DataGrid<Ledger>
                reportId="masters-ledgers"
                rows={filtered}
                columns={[
                  { id: "name", header: "Name", type: "text", width: 240, accessor: (l) => l.name, groupable: true },
                  { id: "group", header: "Group", type: "enum", width: 200, accessor: (l) => resolveGroupLabel(l.group_code ?? defaultGroupCodeForType(l.type), overrides), groupable: true },
                  { id: "type", header: "Type", type: "enum", width: 160, accessor: (l) => LEDGER_TYPES.find((t) => t.value === l.type)?.label ?? l.type, groupable: true },
                  { id: "gstin", header: "GSTIN", type: "text", width: 160, accessor: (l) => l.gstin ?? "" },
                  { id: "state", header: "State", type: "enum", width: 160, accessor: (l) => l.state_code ? `${l.state_code} — ${l.state ?? ""}` : "", groupable: true },
                  { id: "phone", header: "Phone", type: "text", width: 140, accessor: (l) => l.phone ?? "" },
                  { id: "email", header: "Email", type: "text", width: 200, accessor: (l) => l.email ?? "", hidden: true },
                  { id: "opening", header: "Opening", type: "number", width: 140, align: "right", accessor: (l) => (l.opening_balance_is_debit ? 1 : -1) * (l.opening_balance_paise / 100), cell: (l) => l.opening_balance_paise ? `${formatINR(l.opening_balance_paise)} ${l.opening_balance_is_debit ? "Dr" : "Cr"}` : "—", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
                  { id: "credit_limit", header: "Credit limit", type: "number", width: 140, align: "right", accessor: (l) => l.credit_limit_paise / 100, cell: (l) => l.credit_limit_paise ? formatINR(l.credit_limit_paise) : "—", aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
                  { id: "credit_days", header: "Credit days", type: "number", width: 120, align: "right", accessor: (l) => l.credit_days, aggregator: "avg" },
                ] satisfies DGColumn<Ledger>[]}
                onRowClick={canWrite ? (l) => openEdit(l) : undefined}
                globalSearch={(l) => `${l.name} ${l.gstin ?? ""} ${l.phone ?? ""} ${l.email ?? ""}`}
                height={560}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    {canWrite && <TableHead className="w-[100px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => {
                    const typeLabel =
                      LEDGER_TYPES.find((t) => t.value === l.type)?.label ?? l.type;
                    const groupCode = l.group_code ?? defaultGroupCodeForType(l.type);
                    const groupLbl = resolveGroupLabel(groupCode, overrides);
                    const sg = l.subgroup_id ? subgroups.find((s) => s.id === l.subgroup_id) : null;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge className="text-[10px] w-fit">{groupLbl}</Badge>
                            {sg && <span className="text-[10px] text-muted-foreground">↳ {sg.name}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {typeLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {l.gstin ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {l.state_code ? `${l.state_code} — ${l.state ?? ""}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {l.opening_balance_paise
                            ? `${formatINR(l.opening_balance_paise)} ${l.opening_balance_is_debit ? "Dr" : "Cr"}`
                            : "—"}
                        </TableCell>
                        {canWrite && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(l)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onDelete(l)}
                                disabled={activeMembership?.role !== "admin"}
                                title={
                                  activeMembership?.role !== "admin"
                                    ? "Only admins can delete"
                                    : "Delete"
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
