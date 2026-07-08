// Bill-wise opening balances per party.
//
// Users capture the individual pre-migration invoices that were still open
// on the changeover date. Each bill is persisted as a synthetic voucher in
// the local cache — voucher_type = "sales" for debtors / "purchase" for
// creditors, marked `is_opening: true` and posted with NO ledger entries
// (GL side is already carried by the ledger's opening_balance_paise). The
// existing ageing / outstanding logic reads these rows just like any other
// invoice, so day-1 ageing buckets and bill allocations "just work".
//
// Local-only: everything is written to IndexedDB via offlineDb. Nothing
// ever leaves the device.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Info, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import offlineDb from "@/lib/offline/db";
import { useCompany } from "@/lib/company-context";
import { getAllLedgers, useMastersVersion, type CachedLedger } from "@/lib/masters-cache";
import { formatINR, rupeesToPaise } from "@/lib/money";

export const Route = createFileRoute("/app/settings/opening-bills")({
  head: () => ({ meta: [{ title: "Opening bills — Settings" }] }),
  component: OpeningBillsPage,
});

interface OpeningBillRow {
  id: string;
  company_id: string;
  voucher_type: "sales" | "purchase";
  voucher_number: string;
  voucher_date: string;
  due_date: string | null;
  total_paise: number;
  party_ledger_id: string;
  narration: string | null;
  is_opening: boolean;
  is_deleted?: boolean;
  updated_at: string;
}

interface Draft {
  voucher_number: string;
  voucher_date: string;
  due_date: string;
  amount: string;
  narration: string;
}

const emptyDraft = (): Draft => ({
  voucher_number: "",
  voucher_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  amount: "",
  narration: "",
});

function OpeningBillsPage() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  useMastersVersion(); // subscribe so ledgers refresh
  const [ledgerId, setLedgerId] = useState<string>("");
  const [bills, setBills] = useState<OpeningBillRow[]>([]);
  const [allOpeningByParty, setAllOpeningByParty] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; editing: OpeningBillRow | null }>({
    open: false, editing: null,
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const parties = useMemo<CachedLedger[]>(
    () => getAllLedgers().filter((l) => l.type === "sundry_debtor" || l.type === "sundry_creditor"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useMastersVersion()],
  );
  const selected = parties.find((p) => p.id === ledgerId) ?? null;
  const partyKind: "debtor" | "creditor" | null = selected
    ? (selected.type === "sundry_debtor" ? "debtor" : "creditor")
    : null;
  const voucherType: "sales" | "purchase" | null = partyKind === "debtor"
    ? "sales"
    : partyKind === "creditor"
    ? "purchase"
    : null;

  async function reloadAllTotals() {
    if (!activeCompanyId) { setAllOpeningByParty(new Map()); return; }
    const rows = (await (offlineDb as any).cache_vouchers
      .where("company_id").equals(activeCompanyId).toArray()) as OpeningBillRow[];
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.is_deleted) continue;
      if (!r.is_opening) continue;
      if (!r.party_ledger_id) continue;
      m.set(r.party_ledger_id, (m.get(r.party_ledger_id) ?? 0) + (r.total_paise || 0));
    }
    setAllOpeningByParty(m);
  }

  async function reloadBills() {
    if (!activeCompanyId || !ledgerId) { setBills([]); return; }
    setLoading(true);
    try {
      const rows = (await (offlineDb as any).cache_vouchers
        .where("company_id").equals(activeCompanyId).toArray()) as OpeningBillRow[];
      const mine = rows
        .filter((r) => !r.is_deleted && r.is_opening && r.party_ledger_id === ledgerId)
        .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_number.localeCompare(b.voucher_number));
      setBills(mine);
    } finally { setLoading(false); }
  }

  useEffect(() => { void reloadAllTotals(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);
  useEffect(() => { void reloadBills(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId, ledgerId]);

  const openNew = () => {
    if (!ledgerId) { toast.error("Select a party first"); return; }
    setDraft(emptyDraft());
    setDialog({ open: true, editing: null });
  };
  const openEdit = (row: OpeningBillRow) => {
    setDraft({
      voucher_number: row.voucher_number,
      voucher_date: row.voucher_date,
      due_date: row.due_date ?? "",
      amount: (row.total_paise / 100).toFixed(2),
      narration: row.narration ?? "",
    });
    setDialog({ open: true, editing: row });
  };

  async function save() {
    if (!activeCompanyId || !ledgerId || !voucherType) {
      toast.error("Select a party first"); return;
    }
    const num = draft.voucher_number.trim();
    if (!num) { toast.error("Bill / reference number is required"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.voucher_date)) { toast.error("Invalid bill date"); return; }
    const amt = parseFloat(draft.amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Amount must be > 0"); return; }
    const due = draft.due_date.trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) { toast.error("Invalid due date"); return; }

    setSaving(true);
    const now = new Date().toISOString();
    const row: OpeningBillRow = dialog.editing
      ? {
          ...dialog.editing,
          voucher_number: num,
          voucher_date: draft.voucher_date,
          due_date: due || null,
          total_paise: rupeesToPaise(amt),
          narration: draft.narration.trim() || null,
          updated_at: now,
        }
      : {
          id: crypto.randomUUID(),
          company_id: activeCompanyId,
          voucher_type: voucherType,
          voucher_number: num,
          voucher_date: draft.voucher_date,
          due_date: due || null,
          total_paise: rupeesToPaise(amt),
          party_ledger_id: ledgerId,
          narration: draft.narration.trim() || null,
          is_opening: true,
          is_deleted: false,
          updated_at: now,
          // GL-inert defaults so downstream readers behave.
          ...(({ subtotal_paise: rupeesToPaise(amt), cgst_paise: 0, sgst_paise: 0, igst_paise: 0, round_off_paise: 0, is_interstate: false } as any)),
        };
    try {
      await (offlineDb as any).cache_vouchers.put(row);
      toast.success(dialog.editing ? "Bill updated" : "Opening bill added");
      setDialog({ open: false, editing: null });
      await Promise.all([reloadBills(), reloadAllTotals()]);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  }

  async function remove(row: OpeningBillRow) {
    // Cancelled vs Deleted convention: opening bills are not filed on any
    // GST return and carry no GL entries, so hard-delete is safe here.
    if (!confirm(`Delete opening bill "${row.voucher_number}"?`)) return;
    try {
      await (offlineDb as any).cache_vouchers.delete(row.id);
      await Promise.all([reloadBills(), reloadAllTotals()]);
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  const billsTotal = bills.reduce((s, b) => s + (b.total_paise || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/settings" })}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Settings
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bill-wise opening balances</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          Enter the individual invoices that were still open on your changeover date. Each bill is
          stored as an opening entry against the party so ageing buckets and receipt/payment
          allocation work correctly from day 1. The GL side is carried by the party ledger's
          opening balance — keep both in sync.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pick a party</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {parties.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No debtor or creditor ledgers yet.{" "}
              <button className="underline" onClick={() => navigate({ to: "/app/ledgers" })}>
                Create a party ledger
              </button>{" "}
              first.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Party</Label>
                <Select value={ledgerId} onValueChange={setLedgerId}>
                  <SelectTrigger><SelectValue placeholder="Select debtor or creditor…" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {parties.map((p) => {
                      const t = allOpeningByParty.get(p.id) ?? 0;
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            <span>{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({p.type === "sundry_debtor" ? "Debtor" : "Creditor"})
                            </span>
                            {t > 0 && (
                              <span className="text-xs font-mono text-muted-foreground">· {formatINR(t)}</span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {selected && (
                <div className="space-y-1">
                  <Label>Kind</Label>
                  <div className="h-10 flex items-center gap-2 text-sm">
                    <span className="rounded-md border px-2 py-0.5 text-xs uppercase tracking-wide">
                      {partyKind === "debtor" ? "Receivable" : "Payable"}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Bills will post as opening <span className="font-medium">{voucherType}</span> entries.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
            <div>
              <CardTitle className="text-base">Opening bills for {selected.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Total captured: <span className="font-mono">{formatINR(billsTotal)}</span>
              </p>
            </div>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> Add bill
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : bills.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No opening bills captured yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill / Ref #</TableHead>
                    <TableHead className="w-32">Bill date</TableHead>
                    <TableHead className="w-32">Due date</TableHead>
                    <TableHead className="text-right w-40">Amount</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(r)}>
                      <TableCell className="font-medium">{r.voucher_number}</TableCell>
                      <TableCell className="font-mono text-xs">{r.voucher_date}</TableCell>
                      <TableCell className="font-mono text-xs">{r.due_date ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); void remove(r); }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(billsTotal)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialog.open} onOpenChange={(o) => setDialog({ ...dialog, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.editing ? "Edit" : "New"} opening bill</DialogTitle>
            <DialogDescription>
              {selected ? `Party: ${selected.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ob-num">Bill / Reference number *</Label>
              <Input
                id="ob-num"
                value={draft.voucher_number}
                onChange={(e) => setDraft({ ...draft, voucher_number: e.target.value })}
                autoFocus
                maxLength={40}
                placeholder="INV-2024-0342"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-date">Bill date *</Label>
              <Input
                id="ob-date"
                type="date"
                value={draft.voucher_date}
                onChange={(e) => setDraft({ ...draft, voucher_date: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-due">Due date</Label>
              <Input
                id="ob-due"
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ob-amt">Amount (₹) *</Label>
              <Input
                id="ob-amt"
                type="number"
                step="0.01"
                inputMode="decimal"
                className="text-right font-mono"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ob-narr">Narration (optional)</Label>
              <Input
                id="ob-narr"
                value={draft.narration}
                onChange={(e) => setDraft({ ...draft, narration: e.target.value })}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save bill"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
