// Bill-by-bill allocation: pick which open invoices a receipt/payment settles.
// Local-first — reads outstanding bills from the on-device cache.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { listOpenBills, type OpenBill } from "@/lib/doc-linking";
import { toast } from "sonner";

export interface BillAllocation {
  invoice_voucher_id: string;
  voucher_number: string;
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !ledgerId || !companyId) return;
    let cancelled = false;
    setLoading(true);
    listOpenBills(companyId, ledgerId, partyType)
      .then((rows) => {
        if (cancelled) return;
        setBills(rows);
        const init: Record<string, string> = {};
        for (const a of initial || []) init[a.invoice_voucher_id] = (a.amount_paise / 100).toFixed(2);
        setAmts(init);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId, ledgerId, partyType]);

  const allocated = useMemo(
    () => Object.values(amts).reduce((s, v) => s + rupeesToPaise(parseFloat(v) || 0), 0),
    [amts],
  );
  const remaining = totalAvailablePaise - allocated;

  const fillBill = useCallback((b: OpenBill) => {
    setAmts((cur) => {
      const already = Object.entries(cur).reduce(
        (s, [k, v]) => (k === b.id ? s : s + rupeesToPaise(parseFloat(v) || 0)), 0,
      );
      const room = Math.max(0, Math.min(b.pending_paise, totalAvailablePaise - already));
      return { ...cur, [b.id]: (room / 100).toFixed(2) };
    });
  }, [totalAvailablePaise]);

  /** Oldest-first auto settlement (FIFO), the usual practice. */
  const autoFill = useCallback(() => {
    let left = totalAvailablePaise;
    const next: Record<string, string> = {};
    for (const b of bills) {
      if (left <= 0) break;
      const take = Math.min(b.pending_paise, left);
      next[b.id] = (take / 100).toFixed(2);
      left -= take;
    }
    setAmts(next);
  }, [bills, totalAvailablePaise]);

  function save() {
    if (allocated > totalAvailablePaise) {
      toast.error("Allocated amount exceeds the voucher amount");
      return;
    }
    const allocs: BillAllocation[] = bills
      .map((b) => ({
        invoice_voucher_id: b.id,
        voucher_number: b.voucher_number,
        amount_paise: rupeesToPaise(parseFloat(amts[b.id] || "0") || 0),
      }))
      .filter((a) => a.amount_paise > 0);
    onSave(allocs);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Adjust against {partyType === "sundry_debtor" ? "sales bills" : "purchase bills"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Available: <span className="font-mono">{formatINR(totalAvailablePaise)}</span> · Adjusted:{" "}
            <span className="font-mono">{formatINR(allocated)}</span> · On account:{" "}
            <span className="font-mono">{formatINR(Math.max(0, remaining))}</span>
          </p>
        </DialogHeader>

        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading open bills…</div>
        ) : bills.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No open bills for this party.</div>
        ) : (
          <>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={autoFill}>Auto-adjust (oldest first)</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Bill No.</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead>
                <TableHead className="text-right">Bill amount</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Adjust (₹)</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.voucher_number}</TableCell>
                    <TableCell className="font-mono text-xs">{b.voucher_date}</TableCell>
                    <TableCell className="font-mono text-xs">{b.due_date || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatINR(b.total_paise)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(b.pending_paise)}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" step="0.01" className="ml-auto h-8 w-32 text-right font-mono"
                        value={amts[b.id] || ""}
                        onChange={(e) => setAmts((cur) => ({ ...cur, [b.id]: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => fillBill(b)}>Full</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        <DialogFooter>
          {remaining < 0 && <Badge variant="destructive">Over-adjusted by {formatINR(-remaining)}</Badge>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={remaining < 0}>Save adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
