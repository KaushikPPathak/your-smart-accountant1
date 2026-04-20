import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ShoppingCart,
  ShoppingBag,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileMinus,
  FilePlus,
  BookOpen,
  ListOrdered,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function VouchersHub() {
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(false);

  const isNested = location.pathname !== "/app/vouchers";

  useEffect(() => {
    if (isNested || !activeCompanyId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("vouchers")
        .select("id, voucher_date, voucher_number, voucher_type, total_paise, party_ledger_id, reference_no, ledgers:party_ledger_id(name)")
        .eq("company_id", activeCompanyId)
        .order("voucher_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (!alive) return;
      if (error) console.error(error);
      setRows((data as unknown as VoucherRow[]) || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [activeCompanyId, isNested]);

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
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">Recent vouchers</h2>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={ListOrdered} title="No vouchers yet" description="Pick a voucher type above to start." />
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.voucher_date}</TableCell>
                    <TableCell className="capitalize">{r.voucher_type.replace("_", " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voucher_number}</TableCell>
                    <TableCell>{r.ledgers?.name ?? "—"}</TableCell>
                    <TableCell>{r.reference_no ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
