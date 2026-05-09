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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const TYPES = ["all", "sales", "purchase", "receipt", "payment", "journal", "credit_note", "debit_note", "sales_order", "delivery_note", "quotation"] as const;

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
    if (error) console.error(error);
    setRows((data as unknown as VoucherRow[]) || []);
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
        {QUICK.map((q) => (
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
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={ListOrdered} title="No vouchers" description="Pick a voucher type above to start." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>No.</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const printable = ["sales", "purchase", "credit_note", "debit_note"].includes(r.voucher_type);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: r.id } })}
                      title="Click to edit"
                    >
                      <TableCell>{r.voucher_date}</TableCell>
                      <TableCell className="capitalize">{r.voucher_type.replace("_", " ")}</TableCell>
                      <TableCell className="font-mono text-xs">{r.voucher_number}</TableCell>
                      <TableCell>{r.ledgers?.name ?? "—"}</TableCell>
                      <TableCell>{r.reference_no ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
