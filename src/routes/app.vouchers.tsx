import { markVoucherOrigin } from "@/lib/voucher-return";
import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ShoppingCart,
  ShoppingBag,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileMinus,
  FilePlus,
  BookOpen,
  ListOrdered,
  Printer,
  Trash2,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { EmptyState } from "@/components/EmptyState";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { FyDatePicker } from "@/components/ui/fy-date-picker";

export const Route = createFileRoute("/app/vouchers")({
  head: () => ({ meta: [{ title: "Vouchers — Your Mehtaji" }] }),
  component: VouchersHub,
});

const QUICK = [
  { type: "sales", label: "Sales", hotkey: "Alt+S", icon: ShoppingCart, to: "/app/vouchers/new/sales" },
  { type: "purchase", label: "Purchase", hotkey: "Alt+P", icon: ShoppingBag, to: "/app/vouchers/new/purchase" },
  { type: "receipt", label: "Receipt", hotkey: "Alt+R", icon: ArrowDownToLine, to: "/app/vouchers/new/receipt" },
  { type: "payment", label: "Payment", hotkey: "Alt+Y", icon: ArrowUpFromLine, to: "/app/vouchers/new/payment" },
  { type: "credit_note", label: "Credit Note", hotkey: "Alt+C", icon: FileMinus, to: "/app/vouchers/new/credit_note" },
  { type: "debit_note", label: "Debit Note", hotkey: "Alt+D", icon: FilePlus, to: "/app/vouchers/new/debit_note" },
  { type: "journal", label: "Journal / Contra", hotkey: "Alt+J", icon: BookOpen, to: "/app/vouchers/new/journal" },
  { type: "sales_order", label: "Sales Order", hotkey: "Alt+O", icon: ShoppingCart, to: "/app/vouchers/new/sales_order" },
  { type: "delivery_note", label: "Delivery Challan", hotkey: "Alt+L", icon: ShoppingBag, to: "/app/vouchers/new/delivery_note" },
  { type: "quotation", label: "Quotation", hotkey: "Alt+Q", icon: FilePlus, to: "/app/vouchers/new/quotation" },
  { type: "manufacturing", label: "Mfg & Process JV", hotkey: "Alt+M", icon: Boxes, to: "/app/vouchers/new/manufacturing", requires: "inventory" as const },
] as const;

interface VoucherRow {
  id: string;
  voucher_date: string;
  voucher_number: string;
  voucher_type: string;
  total_paise: number;
  party_ledger_id: string | null;
  reference_no: string | null;
  ledgers?: { name: string } | null;
}

const TYPES = ["all", "sales", "purchase", "receipt", "payment", "journal", "credit_note", "debit_note", "sales_order", "delivery_note", "quotation", "manufacturing"] as const;

function VouchersHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const isNested = location.pathname !== "/app/vouchers";
  const canDelete = activeMembership?.role === "admin";

  const load = async () => {
    if (!activeCompanyId) return;
    setLoading(true);

    const loadFromCache = async () => {
      const { readVouchers, readLedgers } = await import("@/lib/offline/cache-read");
      const [vchs, ledgers] = await Promise.all([
        readVouchers(activeCompanyId, {
          voucher_type: type !== "all" ? type : undefined,
          from: from || undefined,
          to: to || undefined,
        }),
        readLedgers(activeCompanyId),
      ]);
      const ledgerById = new Map<string, { name: string }>();
      for (const l of ledgers as any[]) ledgerById.set(l.id, { name: l.name });
      const rows = (vchs as any[]).slice(0, 500).map((v) => ({
        id: v.id,
        voucher_date: v.voucher_date,
        voucher_number: v.voucher_number,
        voucher_type: v.voucher_type,
        total_paise: v.total_paise,
        party_ledger_id: v.party_ledger_id,
        reference_no: v.reference_no,
        ledgers: v.party_ledger_id ? ledgerById.get(v.party_ledger_id) ?? null : null,
      })) as unknown as VoucherRow[];
      setRows(rows);
    };

    const { isOnlineNow } = await import("@/lib/offline/online-status");
    if (!isOnlineNow()) {
      try { await loadFromCache(); } catch { setRows([]); }
      setLoading(false);
      return;
    }

    try {
      let q = supabase
        .from("vouchers")
        .select("id, voucher_date, voucher_number, voucher_type, total_paise, party_ledger_id, reference_no, ledgers:party_ledger_id(name)")
        .eq("company_id", activeCompanyId)
        .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (type !== "all") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        q = q.eq("voucher_type", type as any);
      }
      if (from) q = q.gte("voucher_date", from);
      if (to) q = q.lte("voucher_date", to);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as unknown as VoucherRow[]) || []);
    } catch (err) {
      console.error(err);
      try { await loadFromCache(); } catch { setRows([]); }
    }
    setLoading(false);
  };


  useEffect(() => {
    if (isNested) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, isNested, type, from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.voucher_number.toLowerCase().includes(q) ||
        (r.ledgers?.name ?? "").toLowerCase().includes(q) ||
        (r.reference_no ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const onPrint = async (r: VoucherRow) => {
    if (!activeCompanyId) return;
    const printable = ["sales", "purchase", "credit_note", "debit_note"];
    if (!printable.includes(r.voucher_type)) {
      toast.error("Print is available only for invoices and credit/debit notes");
      return;
    }
    try {
      await downloadInvoicePdf(r.id, activeCompanyId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    }
  };

  const onDelete = async (r: VoucherRow) => {
    if (!confirm(`Delete voucher ${r.voucher_number}? This cannot be undone.`)) return;
    const { error: e1 } = await supabase.from("voucher_entries").delete().eq("voucher_id", r.id);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from("voucher_items").delete().eq("voucher_id", r.id);
    if (e2) { toast.error(e2.message); return; }
    const { error: e3 } = await supabase.from("vouchers").delete().eq("id", r.id);
    if (e3) { toast.error(e3.message); return; }
    toast.success("Voucher deleted");
    load();
  };

  if (isNested) return <Outlet />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vouchers</h1>
        <p className="text-sm text-muted-foreground">
          Create entries with Busy-style hotkeys. Press <kbd className="rounded border px-1">Ctrl+S</kbd> to save, <kbd className="rounded border px-1">Esc</kbd> to cancel.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {QUICK.filter((q) => {
          if ((q as { requires?: string }).requires === "inventory") {
            return !!activeMembership?.companies.inventory_enabled;
          }
          return true;
        }).map((q) => (
          <Link key={q.type} to={q.to}>
            <Card className="transition-colors hover:border-primary">
              <CardContent className="flex flex-col items-start gap-2 p-4">
                <q.icon className="h-5 w-5 text-primary" />
                <div className="font-medium">{q.label}</div>
                <Badge variant="secondary" className="text-[10px]">{q.hotkey}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t === "all" ? "All types" : t.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <FyDatePicker value={from} onChange={setFrom} className="w-[170px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <FyDatePicker value={to} onChange={setTo} className="w-[170px]" />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs">Search</Label>
              <Input placeholder="Number / party / reference" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={ListOrdered} title="No vouchers" description="Pick a voucher type above to start." />
          ) : (
            <DataGrid<VoucherRow>
              reportId="vouchers-list"
              rows={filtered}
              globalSearch={(r) => `${r.voucher_number} ${r.ledgers?.name ?? ""} ${r.reference_no ?? ""}`}
              onRowClick={(r) => { markVoucherOrigin(); navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: r.id } }); }}
              height={560}
              columns={[
                { id: "date", header: "Date", type: "date", width: 110, accessor: (r) => r.voucher_date, cell: (r) => fmtIndianDate(r.voucher_date) },
                { id: "type", header: "Type", type: "enum", width: 130, groupable: true, accessor: (r) => r.voucher_type.replace("_", " "), cell: (r) => <span className="capitalize">{r.voucher_type.replace("_", " ")}</span> },
                { id: "number", header: "No.", type: "text", width: 110, accessor: (r) => r.voucher_number },
                { id: "party", header: "Party", type: "text", width: 240, groupable: true, accessor: (r) => r.ledgers?.name ?? "", cell: (r) => r.ledgers?.name ?? "—" },
                { id: "ref", header: "Ref", type: "text", width: 120, accessor: (r) => r.reference_no ?? "" },
                {
                  id: "amount", header: "Amount", type: "number", width: 140, align: "right",
                  accessor: (r) => r.total_paise / 100, cell: (r) => formatINR(r.total_paise),
                  aggregator: "sum",
                  formatAggregate: (v) => formatINR(Math.round(v * 100)),
                  formatGroupValue: (v) => formatINR(Math.round(v * 100)),
                },
                {
                  id: "actions", header: "", width: 110, groupable: false, align: "right",
                  accessor: () => "",
                  cell: (r) => {
                    const printable = ["sales", "purchase", "credit_note", "debit_note"].includes(r.voucher_type);
                    return (
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {printable && (
                          <Button variant="ghost" size="icon" title="Print invoice" onClick={() => onPrint(r)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(r)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    );
                  },
                },
              ] as DGColumn<VoucherRow>[]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
