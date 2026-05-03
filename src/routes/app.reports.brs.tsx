import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { useFyAsOfState } from "@/components/reports/ReportToolbar";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports/brs")({
  head: () => ({ meta: [{ title: "Bank Reconciliation (BRS) — Reports" }] }),
  component: BrsPage,
});

interface BankLedger { id: string; name: string; opening_balance_paise: number; opening_balance_is_debit: boolean }
interface Entry {
  id: string;
  debit_paise: number;
  credit_paise: number;
  cleared_date: string | null;
  vouchers: { voucher_date: string; voucher_number: string; voucher_type: string; reference_no: string | null } | null;
}

function BrsPage() {
  const { activeCompanyId } = useCompany();
  const [ledgers, setLedgers] = useState<BankLedger[]>([]);
  const [ledgerId, setLedgerId] = useState("");
  const { asOf, setAsOf } = useFyAsOfState();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [bankBal, setBankBal] = useState("");

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("ledgers")
      .select("id, name, opening_balance_paise, opening_balance_is_debit")
      .eq("company_id", activeCompanyId)
      .in("type", ["bank", "cash"])
      .order("name")
      .then(({ data }) => {
        setLedgers((data || []) as BankLedger[]);
        if (data && data.length && !ledgerId) setLedgerId(data[0].id);
      });
  }, [activeCompanyId, ledgerId]);

  const load = () => {
    if (!ledgerId || !activeCompanyId) return;
    supabase.from("voucher_entries")
      .select("id, debit_paise, credit_paise, cleared_date, vouchers!inner(voucher_date, voucher_number, voucher_type, reference_no, company_id)")
      .eq("ledger_id", ledgerId)
      .eq("vouchers.company_id", activeCompanyId)
      .lte("vouchers.voucher_date", asOf)
      .then(({ data }) => setEntries((data || []) as unknown as Entry[]));
  };
  useEffect(load, [ledgerId, asOf, activeCompanyId]);

  const ledger = ledgers.find((l) => l.id === ledgerId);

  const { bookBal, clearedBal, uncleared } = useMemo(() => {
    const ob = ledger ? (ledger.opening_balance_is_debit ? 1 : -1) * ledger.opening_balance_paise : 0;
    let book = ob, cleared = ob;
    const uncl: Entry[] = [];
    for (const e of entries) {
      const delta = e.debit_paise - e.credit_paise;
      book += delta;
      if (e.cleared_date) cleared += delta;
      else uncl.push(e);
    }
    return { bookBal: book, clearedBal: cleared, uncleared: uncl };
  }, [entries, ledger]);

  const bankBalPaise = Math.round((parseFloat(bankBal) || 0) * 100);
  const diff = clearedBal - bankBalPaise;

  async function toggleClear(entry: Entry) {
    const newDate = entry.cleared_date ? null : asOf;
    const { error } = await supabase.from("voucher_entries").update({ cleared_date: newDate }).eq("id", entry.id);
    if (error) toast.error(error.message);
    else { toast.success(newDate ? "Marked cleared" : "Marked uncleared"); load(); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Bank / Cash Ledger</Label>
            <Select value={ledgerId} onValueChange={setLedgerId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {ledgers.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>As of</Label>
            <FyDatePicker value={asOf} onChange={setAsOf} />
          </div>
          <div className="space-y-1">
            <Label>Bank Statement Balance (₹)</Label>
            <Input type="number" step="0.01" value={bankBal} onChange={(e) => setBankBal(e.target.value)} placeholder="From your passbook" />
          </div>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Book balance</span><span className="font-mono">{formatINR(bookBal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cleared balance</span><span className="font-mono">{formatINR(clearedBal)}</span></div>
            <div className={`flex justify-between font-semibold ${diff === 0 ? "text-emerald-600" : "text-destructive"}`}>
              <span>Difference</span><span className="font-mono">{formatINR(Math.abs(diff))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {uncleared.length} uncleared of {entries.length} entries · click ✓ to mark cleared with bank date
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Book Date</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">No entries.</TableCell></TableRow>
              ) : entries.map((e) => (
                <TableRow key={e.id} className={e.cleared_date ? "opacity-60" : ""}>
                  <TableCell className="font-mono text-xs">{e.vouchers?.voucher_date}</TableCell>
                  <TableCell className="text-xs">{e.vouchers?.voucher_number} <span className="text-muted-foreground">({e.vouchers?.voucher_type})</span></TableCell>
                  <TableCell className="text-xs">{e.vouchers?.reference_no || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.debit_paise ? formatINR(e.debit_paise) : ""}</TableCell>
                  <TableCell className="text-right font-mono">{e.credit_paise ? formatINR(e.credit_paise) : ""}</TableCell>
                  <TableCell>
                    {e.cleared_date
                      ? <Badge variant="default">Cleared {e.cleared_date}</Badge>
                      : <Badge variant="outline">Uncleared</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={e.cleared_date ? "ghost" : "outline"} onClick={() => toggleClear(e)}>
                      {e.cleared_date ? <><Undo2 className="h-3 w-3 mr-1" />Undo</> : <><Check className="h-3 w-3 mr-1" />Clear</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
