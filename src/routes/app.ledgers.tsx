import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { lookupGstin } from "@/lib/gstin-lookup.functions";
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
  GSTIN_REGEX,
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
import { ledgerFormSchema as schema } from "@/lib/schemas/ledger";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";

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
  const [gstinLooking, setGstinLooking] = useState(false);
  const lookedRef = useRef<string>("");
  const { view, setView } = useReportView("masters-ledgers");

  useEffect(() => {
    if (!open) return;
    const g = form.gstin.trim().toUpperCase();
    if (g.length !== 15 || !GSTIN_REGEX.test(g) || g === lookedRef.current) return;
    lookedRef.current = g;
    setGstinLooking(true);
    lookupGstin({ data: { gstin: g } })
      .then((res) => {
        if (!res.ok || !res.data) {
          toast.error(res.error || "GSTIN lookup failed");
          return;
        }
        const d = res.data;
        setForm((f) => {
          const stateMatch = INDIAN_STATES.find((s) => s.code === d.stateCode);
          return {
            ...f,
            name: f.name.trim() ? f.name : d.tradeName || d.legalName,
            address: f.address.trim() ? f.address : d.address,
            state_code: f.state_code || d.stateCode || "",
            state: f.state || stateMatch?.name || "",
          };
        });
        toast.success("GSTIN details fetched");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Lookup failed"))
      .finally(() => setGstinLooking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.gstin, open]);

  const load = async () => {
    if (!activeCompanyId) {
      setLedgers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("ledgers")
      .select("*")
      .eq("company_id", activeCompanyId)
      .order("name", { ascending: true });
    if (error) {
      toast.error(error.message);
      setLedgers([]);
    } else {
      setLedgers((data ?? []) as Ledger[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

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
    lookedRef.current = "";
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
    });
    lookedRef.current = l.gstin ?? "";
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
      isOnlineNow()
        ? (editing ? "Ledger updated" : "Ledger created")
        : (editing ? "Ledger update queued — will sync when online" : "Ledger queued — will sync when online"),
    );
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
    load();
  };

  const onDelete = async (l: Ledger) => {
    if (!confirm(`Delete ledger "${l.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("ledgers").delete().eq("id", l.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Ledger deleted");
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
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto px-4 sm:px-6 py-3 flex-1 min-h-0">
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="name">Ledger name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                        // Auto-pick a sensible group when changing type, unless the
                        // currently selected group is still valid for this type.
                        const cur = form.group_code ? GROUP_BY_CODE[form.group_code] : undefined;
                        const stillValid = cur?.ledgerTypes.includes(newType);
                        setForm({
                          ...form,
                          type: v,
                          group_code: stillValid ? form.group_code : defaultGroupCodeForType(newType),
                        });
                      }}
                    >
                      <SelectTrigger id="type">
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
                        // When group changes, also normalise the underlying ledger.type
                        // so postings & legacy reports keep working.
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
                      <SelectTrigger id="group_code">
                        <SelectValue placeholder="Select group" />
                      </SelectTrigger>
                      <SelectContent>
                        {(["BS_LIAB", "BS_ASSET", "TRADING", "PL"] as const).map((sec) => (
                          <div key={sec}>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
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
                        <SelectTrigger id="subgroup_id">
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
                  <div className="space-y-1">
                    <Label htmlFor="gstin" className="flex items-center gap-2">
                      GSTIN {gstinLooking && <Loader2 className="h-3 w-3 animate-spin" />}
                    </Label>
                    <Input
                      id="gstin"
                      value={form.gstin}
                      onChange={(e) =>
                        setForm({ ...form, gstin: e.target.value.toUpperCase() })
                      }
                      maxLength={15}
                      placeholder="22AAAAA0000A1Z5"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="state_code">State</Label>
                    <Select value={form.state_code} onValueChange={onStateCodeChange}>
                      <SelectTrigger id="state_code">
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
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      maxLength={20}
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
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pan">PAN</Label>
                    <Input id="pan" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="opening_balance">Opening balance (₹)</Label>
                    <Input
                      id="opening_balance"
                      type="number"
                      step="0.01"
                      value={form.opening_balance}
                      onChange={(e) =>
                        setForm({ ...form, opening_balance: e.target.value })
                      }
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ob_type">Dr / Cr</Label>
                    <Select
                      value={form.opening_balance_is_debit ? "dr" : "cr"}
                      onValueChange={(v) =>
                        setForm({ ...form, opening_balance_is_debit: v === "dr" })
                      }
                    >
                      <SelectTrigger id="ob_type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dr">Debit (Dr)</SelectItem>
                        <SelectItem value="cr">Credit (Cr)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="credit_limit">Credit limit (₹)</Label>
                    <Input id="credit_limit" type="number" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="credit_days">Credit days</Label>
                    <Input id="credit_days" type="number" value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: e.target.value })} placeholder="0" />
                  </div>
                </div>
                <DialogFooter className="px-4 sm:px-6 py-3 border-t shrink-0 bg-background gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
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
