import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Boxes, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { GST_RATES, UNITS } from "@/lib/constants";
import { EmptyState } from "@/components/EmptyState";
import { itemFormSchema as schema } from "@/lib/schemas/item";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { createItem, updateItem, deleteItem } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";
import { HsnCodeAutocomplete } from "@/components/HsnCodeAutocomplete";

export const Route = createFileRoute("/app/items")({
  head: () => ({ meta: [{ title: "Items — Your Mehtaji" }] }),
  component: ItemsPage,
});

interface Item {
  id: string;
  name: string;
  hsn_code: string | null;
  unit: string;
  gst_rate: number;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
  purchase_price_paise: number;
  sale_price_paise: number;
  reorder_level: number;
  is_active: boolean;
}

type FormState = {
  name: string;
  hsn_code: string;
  unit: string;
  gst_rate: string;
  purchase_price: string;
  sale_price: string;
  opening_stock_qty: string;
  opening_stock_rate: string;
  reorder_level: string;
};


const emptyForm: FormState = {
  name: "",
  hsn_code: "",
  unit: "NOS",
  gst_rate: "18",
  purchase_price: "",
  sale_price: "",
  opening_stock_qty: "",
  opening_stock_rate: "",
  reorder_level: "",
};

function ItemsPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const { view, setView } = useReportView("masters-items");




  const load = async () => {
    if (!activeCompanyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("company_id", activeCompanyId)
      .order("name", { ascending: true });
    if (error) {
      toast.error(error.message);
      setItems([]);
    } else {
      setItems((data ?? []) as Item[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  const isLow = (i: Item) =>
    i.reorder_level > 0 && i.opening_stock_qty <= i.reorder_level;

  const lowCount = useMemo(() => items.filter(isLow).length, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (showLowOnly && !isLow(i)) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.hsn_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, showLowOnly]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (i: Item) => {
    setEditing(i);
    setForm({
      name: i.name,
      hsn_code: i.hsn_code ?? "",
      unit: i.unit,
      gst_rate: String(i.gst_rate),
      purchase_price: i.purchase_price_paise
        ? String(paiseToRupees(i.purchase_price_paise))
        : "",
      sale_price: i.sale_price_paise
        ? String(paiseToRupees(i.sale_price_paise))
        : "",
      opening_stock_qty: i.opening_stock_qty ? String(i.opening_stock_qty) : "",
      opening_stock_rate: i.opening_stock_rate_paise
        ? String(paiseToRupees(i.opening_stock_rate_paise))
        : "",
      reorder_level: i.reorder_level ? String(i.reorder_level) : "",
    });
    setOpen(true);
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
    const num = (s?: string) => {
      const v = parseFloat(s ?? "");
      return isFinite(v) ? v : 0;
    };
    const payload = {
      company_id: activeCompanyId,
      name: parsed.data.name,
      hsn_code: parsed.data.hsn_code || null,
      unit: parsed.data.unit,
      gst_rate: parseFloat(parsed.data.gst_rate),
      purchase_price_paise: rupeesToPaise(num(parsed.data.purchase_price)),
      sale_price_paise: rupeesToPaise(num(parsed.data.sale_price)),
      opening_stock_qty: num(parsed.data.opening_stock_qty),
      opening_stock_rate_paise: rupeesToPaise(num(parsed.data.opening_stock_rate)),
      reorder_level: num(parsed.data.reorder_level),
    };

  try {
      if (editing) {
        await updateItem(editing.id, activeCompanyId, payload);
      } else {
        await createItem(payload);
      }
    } catch (err) {
      setSubmitting(false);
      toast.error(err instanceof Error ? err.message : "Save failed");
      return;
    }
    setSubmitting(false);
    toast.success(
      isOnlineNow()
        ? (editing ? "Item updated" : "Item created")
        : (editing ? "Item update queued — will sync when online" : "Item queued — will sync when online"),
    );
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
    load();
  };

  const onDelete = async (i: Item) => {
    if (!confirm(`Delete item "${i.name}"? This cannot be undone.`)) return;
    if (!activeCompanyId) return;
    try {
      await deleteItem(i.id, activeCompanyId, i.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      return;
    }
    toast.success(isOnlineNow() ? "Item deleted" : "Delete queued — will sync when online");
    load();
  };

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const totalStockValue = items.reduce(
    (acc, i) => acc + i.opening_stock_qty * i.opening_stock_rate_paise,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Items / Stock</h1>
          <p className="text-sm text-muted-foreground">
            Stock items with HSN, unit, GST, purchase/sale price and low-stock alerts.
          </p>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" /> New item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit item" : "Create new item"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="name">Item name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      autoFocus
                    />
                  </div>
                  
                  {/* HSN CODE COLUMN SECTION WITH AUTO-POPUP OVERLAY */}
                  <div className="space-y-1.5 relative">
                    <Label htmlFor="hsn_code">HSN / SAC code</Label>
                    <Input
                      id="hsn_code"
                      value={form.hsn_code}
                      onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      onFocus={() => form.hsn_code.trim().length >= 4 && setShowSuggestions(true)}
                      maxLength={10}
                      placeholder="Type 4 digits to match..."
                      autoComplete="off"
                    />
                    
                    {showSuggestions && hsnSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full bg-popover text-popover-foreground border rounded-md shadow-lg max-h-52 overflow-y-auto mt-1 text-xs font-sans">
                        {hsnSuggestions.map((rec) => (
                          <div
                            key={rec.hsn_code}
                            onMouseDown={() => handleSelectHsn(rec)}
                            className="p-2 hover:bg-accent hover:text-accent-foreground cursor-pointer border-b last:border-0 flex flex-col gap-0.5"
                          >
                            <div className="flex justify-between font-mono font-bold text-primary">
                              <span>{rec.hsn_code}</span>
                              <span className="text-muted-foreground text-[10px]">
                                GST: {rec.is_exempt ? "Exempt" : `${rec.igst_rate || (rec.cgst_rate || 0) + (rec.sgst_rate || 0)}%`}
                              </span>
                            </div>
                            {rec.description && (
                              <span className="text-muted-foreground truncate max-w-full block">
                                {rec.description}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <HsnInlineHint
                      code={form.hsn_code}
                      onResolved={(rec) => {
                        const rate = rec.is_exempt ? 0 : (rec.igst_rate || rec.cgst_rate + rec.sgst_rate);
                        const match = (GST_RATES as readonly number[]).find((g) => Math.abs(g - rate) < 0.001);
                        if (match !== undefined) {
                          setForm((f) => ({ ...f, gst_rate: String(match) }));
                        }
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="unit">Unit *</Label>
                    <Select
                      value={form.unit}
                      onValueChange={(v) => setForm({ ...form, unit: v })}
                    >
                      <SelectTrigger id="unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="gst_rate">GST rate (%) *</Label>
                    <Select
                      value={form.gst_rate}
                      onValueChange={(v) => setForm({ ...form, gst_rate: v })}
                    >
                      <SelectTrigger id="gst_rate">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase_price">Purchase price (₹)</Label>
                    <Input
                      id="purchase_price"
                      type="number"
                      step="0.01"
                      value={form.purchase_price}
                      onChange={(e) =>
                        setForm({ ...form, purchase_price: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sale_price">Sale price (₹)</Label>
                    <Input
                      id="sale_price"
                      type="number"
                      step="0.01"
                      value={form.sale_price}
                      onChange={(e) =>
                        setForm({ ...form, sale_price: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reorder_level">Reorder level</Label>
                    <Input
                      id="reorder_level"
                      type="number"
                      step="0.001"
                      value={form.reorder_level}
                      onChange={(e) =>
                        setForm({ ...form, reorder_level: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="opening_stock_qty">Opening stock qty</Label>
                    <Input
                      id="opening_stock_qty"
                      type="number"
                      step="0.001"
                      value={form.opening_stock_qty}
                      onChange={(e) =>
                        setForm({ ...form, opening_stock_qty: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="opening_stock_rate">Opening rate (₹ per unit)</Label>
                    <Input
                      id="opening_stock_rate"
                      type="number"
                      step="0.01"
                      value={form.opening_stock_rate}
                      onChange={(e) =>
                        setForm({ ...form, opening_stock_rate: e.target.value })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Saving…" : editing ? "Save changes" : "Create item"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">All items ({items.length})</CardTitle>
            {items.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Opening stock value: {formatINR(totalStockValue)}
                {lowCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                    <AlertTriangle className="h-3 w-3" /> {lowCount} low stock
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ViewSwitcher view={view} onChange={setView} classicLabel="Table" />
            <Button
              variant={showLowOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowLowOnly((s) => !s)}
              disabled={lowCount === 0}
            >
              <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Low stock
            </Button>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, HSN…"
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
              icon={Boxes}
              title={items.length === 0 ? "No items yet" : "No matches"}
              description={
                items.length === 0
                  ? "Create stock items so you can use them in sales and purchase invoices."
                  : "Try a different search term."
              }
            />
          ) : view === "grid" ? (
            <div className="p-3">
              <DataGrid<Item>
                reportId="masters-items"
                rows={filtered}
                columns={[
                  { id: "name", header: "Name", type: "text", width: 240, accessor: (i) => i.name, groupable: true },
                  { id: "hsn", header: "HSN", type: "text", width: 120, accessor: (i) => i.hsn_code ?? "", groupable: true },
                  { id: "unit", header: "Unit", type: "enum", width: 100, accessor: (i) => i.unit, groupable: true },
                  { id: "gst", header: "GST %", type: "number", width: 90, align: "right", accessor: (i) => i.gst_rate, groupable: true, aggregator: "avg" },
                  { id: "purchase", header: "Purchase ₹", type: "number", width: 130, align: "right", accessor: (i) => i.purchase_price_paise / 100, cell: (i) => i.purchase_price_paise ? formatINR(i.purchase_price_paise) : "—", aggregator: "avg", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
                  { id: "sale", header: "Sale ₹", type: "number", width: 130, align: "right", accessor: (i) => i.sale_price_paise / 100, cell: (i) => i.sale_price_paise ? formatINR(i.sale_price_paise) : "—", aggregator: "avg", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
                  { id: "qty", header: "Stock qty", type: "number", width: 110, align: "right", accessor: (i) => i.opening_stock_qty, aggregator: "sum" },
                  { id: "reorder", header: "Reorder", type: "number", width: 100, align: "right", accessor: (i) => i.reorder_level },
                  { id: "value", header: "Stock value", type: "number", width: 140, align: "right", accessor: (i) => (i.opening_stock_qty * i.opening_stock_rate_paise) / 100, cell: (i) => { const v = i.opening_stock_qty * i.opening_stock_rate_paise; return v ? formatINR(v) : "—"; }, aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
                  { id: "low", header: "Low?", type: "enum", width: 80, accessor: (i) => isLow(i) ? "Low" : "OK", groupable: true },
                ] satisfies DGColumn<Item>[]}
                onRowClick={canWrite ? (i) => openEdit(i) : undefined}
                globalSearch={(i) => `${i.name} ${i.hsn_code ?? ""} ${i.unit}`}
                height={560}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Purchase ₹</TableHead>
                    <TableHead className="text-right">Sale ₹</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    {canWrite && <TableHead className="w-[100px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const value = i.opening_stock_qty * i.opening_stock_rate_paise;
                    const low = isLow(i);
                    return (
                      <TableRow key={i.id} className={low ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                        <TableCell className="font-medium">
                          {i.name}
                          {low && (
                            <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700 text-[10px] dark:text-amber-300">
                              Low
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {i.hsn_code ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {i.unit}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {i.gst_rate}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {i.purchase_price_paise ? formatINR(i.purchase_price_paise) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {i.sale_price_paise ? formatINR(i.sale_price_paise) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {i.opening_stock_qty || "—"}
                          {i.reorder_level > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              / {i.reorder_level}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {value ? formatINR(value) : "—"}
                        </TableCell>
                        {canWrite && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(i)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onDelete(i)}
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
