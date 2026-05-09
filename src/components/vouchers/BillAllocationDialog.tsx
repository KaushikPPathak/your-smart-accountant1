// Bill-by-bill allocation: pick which open invoices a receipt/payment settles.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { toast } from "sonner";

interface OpenBill {
  id: string;
  voucher_number: string;
  voucher_date: string;
  due_date: string | null;
  total_paise: number;
  paid_paise: number;
  pending_paise: number;
}

export interface BillAllocation {
  invoice_voucher_id: string;
  amount_paise: number;
}

export function BillAllocationDialog({
  open, onOpenChange, companyId, ledgerId, partyType, totalAvailablePaise, initial, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  ledgerId: string;
  partyType: "sundry_debtor" | "sundry_creditor";
  totalAvailablePaise: number;
  initial?: BillAllocation[];
  onSave: (allocs: BillAllocation[]) => void;
}) {
  const [bills, setBills] = useState<OpenBill[]>([]);
  const [amts, setAmts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !ledgerId) return;
    const invoiceType = partyType === "sundry_debtor" ? "sales" : "purchase";
    Promise.all([
      supabase.from("vouchers")
        .select("id, voucher_number, voucher_date, due_date, total_paise")
        .eq("company_id", companyId)
        .eq("party_ledger_id", ledgerId)
        .eq("voucher_type", invoiceType)
        .order("voucher_date").order("voucher_number", { ascending: true }),
      supabase.from("bill_allocations")
        .select("invoice_voucher_id, amount_paise")
        .eq("ledger_id", ledgerId),
    ]).then(([v, a]) => {
      const paid = new Map<string, number>();
      for (const x of (a.data || [])) paid.set(x.invoice_voucher_id, (paid.get(x.invoice_voucher_id) || 0) + x.amount_paise);
      const open = (v.data || []).map((b) => {
        const p = paid.get(b.id) || 0;
        return { ...b, paid_paise: p, pending_paise: b.total_paise - p };
      }).filter((b) => b.pending_paise > 0);
      setBills(open);
      const init: Record<string, string> = {};
      for (const a of initial || []) init[a.invoice_voucher_id] = (a.amount_paise / 100).toFixed(2);
      setAmts(init);
    });
  }, [open, companyId, ledgerId, partyType, initial]);

  const allocated = useMemo(() => {
    return Object.values(amts).reduce((s, v) => s + rupeesToPaise(parseFloat(v) || 0), 0);
  }, [amts]);
  const remaining = totalAvailablePaise - allocated;

  function fillBill(b: OpenBill) {
    const cur = rupeesToPaise(parseFloat(amts[b.id] || "0") || 0);
    const room = b.pending_paise;
    const canAdd = Math.min(room - cur, totalAvailablePaise - allocated + cur);
    setAmts({ ...amts, [b.id]: ((cur + Math.max(0, canAdd)) / 100).toFixed(2) });
  }

  function save() {
    const allocs: BillAllocation[] = bills
      .map((b) => ({ invoice_voucher_id: b.id, amount_paise: rupeesToPaise(parseFloat(amts[b.id] || "0") || 0) }))
      .filter((a) => a.amount_paise > 0);
    if (allocated > totalAvailablePaise) {
      toast.error("Allocated amount exceeds payment");
      return;
    }
    onSave(allocs);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Allocate against bills</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Available: <span className="font-mono">{formatINR(totalAvailablePaise)}</span> · Allocated: <span className="font-mono">{formatINR(allocated)}</span> · On Account: <span className="font-mono">{formatINR(Math.max(0, remaining))}</span>
          </p>
        </DialogHeader>
        {bills.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No open bills for this party.</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Allocate (₹)</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bills.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.voucher_number}</TableCell>
                  <TableCell className="font-mono text-xs">{b.voucher_date}</TableCell>
                  <TableCell className="font-mono text-xs">{b.due_date || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(b.pending_paise)}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" step="0.01" className="h-8 text-right font-mono w-32 ml-auto"
                      value={amts[b.id] || ""}
                      onChange={(e) => setAmts({ ...amts, [b.id]: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => fillBill(b)}>Fill</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          {remaining < 0 && <Badge variant="destructive">Over-allocated by {formatINR(-remaining)}</Badge>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={remaining < 0}>Save allocation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
