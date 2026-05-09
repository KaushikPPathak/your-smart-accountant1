// Universal voucher viewer / editor.
// Reachable from Day Book, Ledger Statement, Vouchers list, Sales/Purchase
// Register etc. Lets the user edit basic header fields (date, reference,
// narration) and item lines (qty, rate, discount, gst rate) for item-based
// vouchers, or the debit/credit lines for entry-based vouchers. Recomputes
// totals and rewrites voucher_items + voucher_entries on save.
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Printer, Save, Trash2, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR, rupeesToPaise, paiseToRupees, amountInWords } from "@/lib/money";
import { computeLine, sumLines, type GstLineResult } from "@/lib/gst";
import { GST_RATES } from "@/lib/constants";
import { buildItemVoucherPostings } from "@/lib/voucher-postings";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { EwayBillPrepDialog } from "@/components/vouchers/EwayBillPrepDialog";
import { FyDatePicker } from "@/components/ui/fy-date-picker";
import { toast } from "sonner";
import { goBackFromVoucher } from "@/lib/voucher-return";

export const Route = createFileRoute("/app/vouchers/$voucherId")({
  head: () => ({ meta: [{ title: "Edit Voucher — Your Mehtaji" }] }),
  component: VoucherEditPage,
});

type ItemKind = "sales" | "purchase" | "credit_note" | "debit_note";
type EntryKind = "receipt" | "payment" | "journal" | "contra";

interface Voucher {
  id: string;
  company_id: string;
  voucher_type: string;
  voucher_number: string;
  voucher_date: string;
  party_ledger_id: string | null;
  reference_no: string | null;
  narration: string | null;
  is_interstate: boolean;
  place_of_supply_code: string | null;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  igst_paise_2?: never;
  round_off_paise: number;
  total_paise: number;
}
interface ItemLine {
  id?: string;
  item_id: string;
  description: string;
  qty: string;
  rate: string;
  discount: string;
  gst_rate: string;
}
interface EntryLine {
  id?: string;
  ledger_id: string;
  debit: string;
  credit: string;
  narration: string;
}
interface ItemOpt { id: string; name: string; gst_rate: number }
interface LedgerOpt { id: string; name: string; type: string }

function VoucherEditPage() {
  const { voucherId } = useParams({ from: "/app/vouchers/$voucherId" });
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const canWrite = activeMembership?.role === "admin" || activeMembership?.role === "accountant";
  const canDelete = activeMembership?.role === "admin";

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [itemLines, setItemLines] = useState<ItemLine[]>([]);
  const [entryLines, setEntryLines] = useState<EntryLine[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [partyName, setPartyName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);

  const isItemKind = useMemo(
    () => ["sales", "purchase", "credit_note", "debit_note"].includes(voucher?.voucher_type ?? ""),
    [voucher],
  );
  const isEntryKind = useMemo(
    () => ["receipt", "payment", "journal", "contra"].includes(voucher?.voucher_type ?? ""),
    [voucher],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data: v, error } = await supabase
      .from("vouchers")
      .select("*, ledgers:party_ledger_id(name)")
      .eq("id", voucherId)
      .single();
    if (error || !v) {
      toast.error("Voucher not found");
      navigate({ to: "/app/vouchers" });
      return;
    }
    const vRow = v as unknown as Voucher & { ledgers: { name: string } | null };
    setVoucher(vRow);
    setPartyName(vRow.ledgers?.name ?? "");

    const [itemsRes, entriesRes, masterItems, masterLedgers] = await Promise.all([
      supabase.from("voucher_items").select("*").eq("voucher_id", voucherId).order("line_no"),
      supabase.from("voucher_entries").select("*").eq("voucher_id", voucherId).order("line_no"),
      supabase.from("items").select("id, name, gst_rate").eq("company_id", vRow.company_id).eq("is_active", true).order("name"),
      supabase.from("ledgers").select("id, name, type").eq("company_id", vRow.company_id).eq("is_active", true).order("name"),
    ]);
    setItemLines(
      ((itemsRes.data || []) as unknown as { id: string; item_id: string; description: string | null; qty: number; rate_paise: number; discount_paise: number; gst_rate: number }[]).map((r) => ({
        id: r.id,
        item_id: r.item_id,
        description: r.description ?? "",
        qty: String(r.qty),
        rate: paiseToRupees(r.rate_paise).toString(),
        discount: paiseToRupees(r.discount_paise).toString(),
        gst_rate: String(r.gst_rate),
      })),
    );
    setEntryLines(
      ((entriesRes.data || []) as unknown as { id: string; ledger_id: string; debit_paise: number; credit_paise: number; narration: string | null }[]).map((r) => ({
        id: r.id,
        ledger_id: r.ledger_id,
        debit: r.debit_paise ? paiseToRupees(r.debit_paise).toString() : "",
        credit: r.credit_paise ? paiseToRupees(r.credit_paise).toString() : "",
        narration: r.narration ?? "",
      })),
    );
    setItems((masterItems.data || []) as ItemOpt[]);
    setLedgers((masterLedgers.data || []) as LedgerOpt[]);
    setLoading(false);
  }, [voucherId, navigate]);

  useEffect(() => { load(); }, [load]);

  const computed: GstLineResult[] = useMemo(
    () =>
      itemLines.map((l) =>
        computeLine(
          { qty: parseFloat(l.qty) || 0, rate: parseFloat(l.rate) || 0, discount: parseFloat(l.discount) || 0, gstRate: parseFloat(l.gst_rate) || 0 },
          voucher?.is_interstate ?? false,
        ),
      ),
    [itemLines, voucher],
  );
  const totals = useMemo(() => sumLines(computed), [computed]);
  const entryTotals = useMemo(() => {
    return entryLines.reduce(
      (acc, l) => ({
        dr: acc.dr + (parseFloat(l.debit) || 0),
        cr: acc.cr + (parseFloat(l.credit) || 0),
      }),
      { dr: 0, cr: 0 },
    );
  }, [entryLines]);

  function updateItem(idx: number, patch: Partial<ItemLine>) {
    setItemLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function updateEntry(idx: number, patch: Partial<EntryLine>) {
    setEntryLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function save() {
    if (!voucher || !canWrite) return;
    setSaving(true);
    try {
      if (isItemKind) {
        // Update voucher header + totals
        const { error: vErr } = await supabase.from("vouchers").update({
          voucher_date: voucher.voucher_date,
          reference_no: voucher.reference_no,
          narration: voucher.narration,
          subtotal_paise: totals.subtotal_paise,
          cgst_paise: totals.cgst_paise,
          sgst_paise: totals.sgst_paise,
          igst_paise: totals.igst_paise,
          total_paise: totals.total_paise,
        }).eq("id", voucher.id);
        if (vErr) throw vErr;

        // Replace voucher_items
        await supabase.from("voucher_items").delete().eq("voucher_id", voucher.id);
        const newItems = itemLines
          .map((l, i) => {
            if (!l.item_id) return null;
            const c = computed[i];
            if (c.total_paise <= 0) return null;
            return {
              voucher_id: voucher.id,
              item_id: l.item_id,
              line_no: i + 1,
              description: l.description || null,
              qty: parseFloat(l.qty) || 0,
              rate_paise: rupeesToPaise(parseFloat(l.rate) || 0),
              discount_paise: c.discount_paise,
              amount_paise: c.amount_paise,
              taxable_paise: c.taxable_paise,
              gst_rate: c.gst_rate,
              cgst_paise: c.cgst_paise,
              sgst_paise: c.sgst_paise,
              igst_paise: c.igst_paise,
            };
          })
          .filter(Boolean) as object[];
        if (newItems.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: iErr } = await supabase.from("voucher_items").insert(newItems as any);
          if (iErr) throw iErr;
        }

        // Rebuild postings
        if (voucher.party_ledger_id) {
          await supabase.from("voucher_entries").delete().eq("voucher_id", voucher.id);
          const postings = await buildItemVoucherPostings(
            voucher.company_id,
            voucher.voucher_type as ItemKind,
            voucher.party_ledger_id,
            totals,
          );
          const entryRows = postings.map((p) => ({
            voucher_id: voucher.id,
            ledger_id: p.ledger_id,
            debit_paise: p.debit_paise,
            credit_paise: p.credit_paise,
            line_no: p.line_no,
          }));
          const { error: eErr } = await supabase.from("voucher_entries").insert(entryRows);
          if (eErr) throw eErr;
        }
      } else if (isEntryKind) {
        // Validate Dr = Cr
        if (Math.abs(entryTotals.dr - entryTotals.cr) > 0.001) {
          toast.error(`Debit (${entryTotals.dr.toFixed(2)}) must equal Credit (${entryTotals.cr.toFixed(2)})`);
          setSaving(false);
          return;
        }
        const totalP = rupeesToPaise(entryTotals.dr);
        const { error: vErr } = await supabase.from("vouchers").update({
          voucher_date: voucher.voucher_date,
          reference_no: voucher.reference_no,
          narration: voucher.narration,
          subtotal_paise: totalP,
          total_paise: totalP,
        }).eq("id", voucher.id);
        if (vErr) throw vErr;

        await supabase.from("voucher_entries").delete().eq("voucher_id", voucher.id);
        const rows = entryLines
          .filter((l) => l.ledger_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
          .map((l, i) => ({
            voucher_id: voucher.id,
            ledger_id: l.ledger_id,
            line_no: i + 1,
            debit_paise: rupeesToPaise(parseFloat(l.debit) || 0),
            credit_paise: rupeesToPaise(parseFloat(l.credit) || 0),
            narration: l.narration || null,
          }));
        if (rows.length < 2) {
          toast.error("At least two lines required");
          setSaving(false);
          return;
        }
        const { error: eErr } = await supabase.from("voucher_entries").insert(rows);
        if (eErr) throw eErr;
      }
      toast.success("Voucher updated");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!voucher || !canDelete) return;
    if (!confirm(`Delete ${voucher.voucher_number}? This cannot be undone.`)) return;
    await supabase.from("voucher_entries").delete().eq("voucher_id", voucher.id);
    await supabase.from("voucher_items").delete().eq("voucher_id", voucher.id);
    const { error } = await supabase.from("vouchers").delete().eq("id", voucher.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted");
    navigate({ to: "/app/vouchers" });
  }

  if (loading || !voucher) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const printable = ["sales", "purchase", "credit_note", "debit_note"].includes(voucher.voucher_type);
  const requiresEwb = voucher.voucher_type === "sales" && voucher.total_paise > 5_000_000;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => goBackFromVoucher(() => navigate({ to: "/app/vouchers" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              <span className="capitalize">{voucher.voucher_type.replace("_", " ")}</span> · {voucher.voucher_number}
            </h1>
            <p className="text-xs text-muted-foreground">
              {partyName && <>Party: <strong>{partyName}</strong> · </>}
              {voucher.is_interstate ? "Interstate (IGST)" : "Intrastate (CGST/SGST)"}
              {requiresEwb && <Badge variant="destructive" className="ml-2">EWB needed</Badge>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {printable && (
            <Button variant="outline" size="sm" onClick={() => downloadInvoicePdf(voucher.id, voucher.company_id)}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          )}
          {voucher.voucher_type === "sales" && (
            <Button variant="outline" size="sm" onClick={() => setEwbOpen(true)}>
              <Truck className="h-4 w-4 mr-1" /> EWB / E-Invoice
            </Button>
          )}
          {canDelete && (
            <Button variant="outline" size="sm" onClick={del}>
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save changes"}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <FyDatePicker value={voucher.voucher_date} onChange={(v) => setVoucher({ ...voucher, voucher_date: v })} disabled={!canWrite} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reference No.</Label>
            <Input value={voucher.reference_no ?? ""} onChange={(e) => setVoucher({ ...voucher, reference_no: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Voucher No.</Label>
            <Input value={voucher.voucher_number} readOnly className="bg-muted" />
          </div>
          <div className="md:col-span-3 space-y-1">
            <Label className="text-xs">Narration</Label>
            <Textarea rows={2} value={voucher.narration ?? ""} onChange={(e) => setVoucher({ ...voucher, narration: e.target.value })} disabled={!canWrite} />
          </div>
        </CardContent>
      </Card>

      {isItemKind && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="w-24">Rate</TableHead>
                  <TableHead className="w-20">Disc</TableHead>
                  <TableHead className="w-20">GST %</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.item_id} onValueChange={(v) => updateItem(i, { item_id: v })} disabled={!canWrite}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Item" /></SelectTrigger>
                        <SelectContent>
                          {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input value={l.description} onChange={(e) => updateItem(i, { description: e.target.value })} disabled={!canWrite} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} disabled={!canWrite} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} disabled={!canWrite} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.discount} onChange={(e) => updateItem(i, { discount: e.target.value })} disabled={!canWrite} /></TableCell>
                    <TableCell>
                      <Select value={l.gst_rate} onValueChange={(v) => updateItem(i, { gst_rate: v })} disabled={!canWrite}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatINR(computed[i]?.total_paise ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t p-3 flex justify-between text-sm">
              <span className="text-muted-foreground">Taxable {formatINR(totals.subtotal_paise)} · {voucher.is_interstate ? `IGST ${formatINR(totals.igst_paise)}` : `CGST ${formatINR(totals.cgst_paise)} · SGST ${formatINR(totals.sgst_paise)}`}</span>
              <span className="font-semibold font-mono">Total {formatINR(totals.total_paise)}</span>
            </div>
            <p className="px-3 pb-3 text-xs italic text-muted-foreground">{amountInWords(totals.total_paise)}</p>
          </CardContent>
        </Card>
      )}

      {isEntryKind && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ledger</TableHead>
                  <TableHead className="w-32 text-right">Debit</TableHead>
                  <TableHead className="w-32 text-right">Credit</TableHead>
                  <TableHead>Narration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entryLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.ledger_id} onValueChange={(v) => updateEntry(i, { ledger_id: v })} disabled={!canWrite}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Ledger" /></SelectTrigger>
                        <SelectContent>
                          {ledgers.map((lg) => <SelectItem key={lg.id} value={lg.id}>{lg.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.01" className="text-right font-mono" value={l.debit} onChange={(e) => updateEntry(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} disabled={!canWrite} /></TableCell>
                    <TableCell><Input type="number" step="0.01" className="text-right font-mono" value={l.credit} onChange={(e) => updateEntry(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} disabled={!canWrite} /></TableCell>
                    <TableCell><Input value={l.narration} onChange={(e) => updateEntry(i, { narration: e.target.value })} disabled={!canWrite} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t p-3 flex justify-end gap-6 text-sm font-mono">
              <span>Dr {entryTotals.dr.toFixed(2)}</span>
              <span>Cr {entryTotals.cr.toFixed(2)}</span>
              <span className={Math.abs(entryTotals.dr - entryTotals.cr) > 0.001 ? "text-destructive" : "text-muted-foreground"}>
                Diff {(entryTotals.dr - entryTotals.cr).toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Tip: every voucher row in <Link to="/app/reports/day-book" className="underline">Day Book</Link>, <Link to="/app/reports/ledger" className="underline">Ledger Statement</Link>, <Link to="/app/vouchers" className="underline">Vouchers</Link>, and registers links here so you can edit from anywhere.
      </p>

      <EwayBillPrepDialog
        open={ewbOpen}
        onOpenChange={setEwbOpen}
        voucher={{
          id: voucher.id,
          company_id: voucher.company_id,
          voucher_number: voucher.voucher_number,
          voucher_date: voucher.voucher_date,
          total_paise: voucher.total_paise,
          subtotal_paise: voucher.subtotal_paise,
          cgst_paise: voucher.cgst_paise,
          sgst_paise: voucher.sgst_paise,
          igst_paise: voucher.igst_paise,
          is_interstate: voucher.is_interstate,
          place_of_supply_code: voucher.place_of_supply_code,
        }}
      />
    </div>
  );
}
