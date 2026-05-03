import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, Truck, UserPlus, PackagePlus, X } from "lucide-react";
import { QuickLedgerDialog, type QuickLedger } from "./QuickLedgerDialog";
import { QuickItemDialog, type QuickItem } from "./QuickItemDialog";
import { EwayBillPrepDialog } from "./EwayBillPrepDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { formatINR, rupeesToPaise, amountInWords } from "@/lib/money";
import { computeLine, sumLines, isInterstate, type GstLineResult } from "@/lib/gst";
import { GST_RATES, INDIAN_STATES } from "@/lib/constants";
import { buildItemVoucherPostings } from "@/lib/voucher-postings";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { useEnterAsTab } from "./useEnterAsTab";
import { RecentVouchersPanel } from "./RecentVouchersPanel";

type VoucherType = "sales" | "purchase" | "credit_note" | "debit_note" | "sales_order" | "delivery_note" | "quotation";

interface LedgerOpt {
  id: string;
  name: string;
  type: string;
  state_code: string | null;
}
interface ItemOpt {
  id: string;
  name: string;
  unit: string;
  gst_rate: number;
  hsn_code: string | null;
}

interface Line {
  item_id: string;
  description: string;
  qty: string;
  rate: string;
  discount: string;
  gst_rate: string;
}

const blankLine = (): Line => ({
  item_id: "",
  description: "",
  qty: "1",
  rate: "0",
  discount: "0",
  gst_rate: "0",
});

const TITLES: Record<VoucherType, { title: string; partyLabel: string; partyTypes: string[] }> = {
  sales: {
    title: "Sales Invoice",
    partyLabel: "Customer",
    partyTypes: ["sundry_debtor"],
  },
  purchase: {
    title: "Purchase Invoice",
    partyLabel: "Supplier",
    partyTypes: ["sundry_creditor"],
  },
  credit_note: {
    title: "Credit Note (Sales Return)",
    partyLabel: "Customer",
    partyTypes: ["sundry_debtor"],
  },
  debit_note: {
    title: "Debit Note (Purchase Return)",
    partyLabel: "Supplier",
    partyTypes: ["sundry_creditor"],
  },
  sales_order: {
    title: "Sales Order",
    partyLabel: "Customer",
    partyTypes: ["sundry_debtor"],
  },
  delivery_note: {
    title: "Delivery Challan",
    partyLabel: "Customer",
    partyTypes: ["sundry_debtor"],
  },
  quotation: {
    title: "Quotation",
    partyLabel: "Customer",
    partyTypes: ["sundry_debtor"],
  },
};

export function ItemVoucherForm({ voucherType }: { voucherType: VoucherType }) {
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const cfg = TITLES[voucherType];

  const defaultDate = useDefaultFyDate();
  const [date, setDate] = useState(defaultDate);
  const [partyId, setPartyId] = useState("");
  const [refNo, setRefNo] = useState("");
  const [narration, setNarration] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>("");
  const [roundOff, setRoundOff] = useState<boolean>(true);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [companyStateCode, setCompanyStateCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusedLine, setFocusedLine] = useState<number>(0);
  const [savedTick, setSavedTick] = useState(0);
  const [ledgerDlg, setLedgerDlg] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [itemDlg, setItemDlg] = useState<{ open: boolean; editId: string | null; lineIdx: number | null }>({ open: false, editId: null, lineIdx: null });
  const [ewbDlg, setEwbDlg] = useState<{ open: boolean; voucher: { id: string; company_id: string; voucher_number: string; voucher_date: string; total_paise: number; subtotal_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; is_interstate: boolean; place_of_supply_code: string | null } | null }>({ open: false, voucher: null });
  const { lock, locked } = usePeriodLock(date);

  // Load masters
  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [ld, it, co] = await Promise.all([
        supabase
          .from("ledgers")
          .select("id, name, type, state_code")
          .eq("company_id", activeCompanyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("items")
          .select("id, name, unit, gst_rate, hsn_code")
          .eq("company_id", activeCompanyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("companies")
          .select("state_code")
          .eq("id", activeCompanyId)
          .single(),
      ]);
      setLedgers((ld.data || []) as LedgerOpt[]);
      setItems((it.data || []) as ItemOpt[]);
      setCompanyStateCode(co.data?.state_code ?? null);
    })();
  }, [activeCompanyId]);

  const partyOpts = useMemo(
    () => ledgers.filter((l) => cfg.partyTypes.includes(l.type)),
    [ledgers, cfg.partyTypes],
  );
  const partyLedger = useMemo(() => ledgers.find((l) => l.id === partyId), [ledgers, partyId]);
  const interstate = isInterstate(companyStateCode, placeOfSupply || partyLedger?.state_code);

  // Auto-fill place of supply from party state when party changes
  useEffect(() => {
    if (partyLedger?.state_code && !placeOfSupply) {
      setPlaceOfSupply(partyLedger.state_code);
    }
  }, [partyLedger, placeOfSupply]);

  const computed: GstLineResult[] = useMemo(
    () =>
      lines.map((l) =>
        computeLine(
          {
            qty: parseFloat(l.qty) || 0,
            rate: parseFloat(l.rate) || 0,
            discount: parseFloat(l.discount) || 0,
            gstRate: parseFloat(l.gst_rate) || 0,
          },
          interstate,
        ),
      ),
    [lines, interstate],
  );
  const rawTotals = useMemo(() => sumLines(computed), [computed]);
  const roundOffPaise = useMemo(() => {
    if (!roundOff) return 0;
    const rounded = Math.round(rawTotals.total_paise / 100) * 100;
    return rounded - rawTotals.total_paise;
  }, [rawTotals.total_paise, roundOff]);
  const totals = useMemo(
    () => ({ ...rawTotals, total_paise: rawTotals.total_paise + roundOffPaise }),
    [rawTotals, roundOffPaise],
  );

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const onPickItem = (idx: number, itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    setLines((cur) =>
      cur.map((l, i) =>
        i === idx
          ? { ...l, item_id: itemId, gst_rate: it ? String(it.gst_rate) : l.gst_rate }
          : l,
      ),
    );
  };
  const addLine = () => setLines((cur) => [...cur, blankLine()]);
  const removeLine = (idx: number) =>
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((_, i) => i !== idx)));

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const save = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;
    if (!partyId) {
      toast.error(`Select a ${cfg.partyLabel.toLowerCase()}`);
      return;
    }
    const validLines = lines.filter((l, i) => l.item_id && computed[i].total_paise > 0);
    if (validLines.length === 0) {
      toast.error("Add at least one item line");
      return;
    }

    setSaving(true);
    try {
      // 1. Get next voucher number
      const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
        _company_id: activeCompanyId,
        _type: voucherType,
      });
      if (numErr) throw numErr;

      // 2. Insert voucher
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: vData, error: vErr } = await supabase
        .from("vouchers")
        .insert({
          company_id: activeCompanyId,
          created_by: user.id,
          voucher_type: voucherType,
          voucher_number: numData as string,
          voucher_date: date,
          party_ledger_id: partyId,
          reference_no: refNo || null,
          narration: narration || null,
          is_interstate: interstate,
          subtotal_paise: totals.subtotal_paise,
          cgst_paise: totals.cgst_paise,
          sgst_paise: totals.sgst_paise,
          igst_paise: totals.igst_paise,
          round_off_paise: roundOffPaise,
          total_paise: totals.total_paise,
          place_of_supply_code: placeOfSupply || null,
        })
        .select("id")
        .single();
      if (vErr) throw vErr;

      // 3. Insert items
      const itemRows = lines
        .map((l, i) => {
          if (!l.item_id || computed[i].total_paise <= 0) return null;
          const c = computed[i];
          return {
            voucher_id: vData.id,
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
      const { error: iErr } = await supabase
        .from("voucher_items")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(itemRows as any);
      if (iErr) throw iErr;

      // 4. Auto-post double-entry ledger postings so reports balance.
      // Sales orders, delivery challans, and quotations are non-financial — no postings.
      const skipPostings = voucherType === "sales_order" || voucherType === "delivery_note" || voucherType === "quotation";
      if (!skipPostings) {
        const postings = await buildItemVoucherPostings(
          activeCompanyId,
          voucherType as "sales" | "purchase" | "credit_note" | "debit_note",
          partyId,
          { ...totals, round_off_paise: roundOffPaise },
        );
        const entryRows = postings.map((p) => ({
          voucher_id: vData.id,
          ledger_id: p.ledger_id,
          debit_paise: p.debit_paise,
          credit_paise: p.credit_paise,
          line_no: p.line_no,
        }));
        const { error: eErr } = await supabase
          .from("voucher_entries")
          .insert(entryRows);
        if (eErr) throw eErr;
      }

      toast.success(`${cfg.title} ${numData} saved`);

      // Auto-prompt E-Way Bill / E-Invoice for any goods-movement voucher above ₹50,000
      // (sales/purchase + their notes — interstate, or intra-state beyond city limits).
      const movesGoods = voucherType === "sales" || voucherType === "purchase" || voucherType === "credit_note" || voucherType === "debit_note";
      if (movesGoods && totals.total_paise > 5_000_000) {
        setEwbDlg({
          open: true,
          voucher: {
            id: vData.id,
            company_id: activeCompanyId,
            voucher_number: numData as string,
            voucher_date: date,
            total_paise: totals.total_paise,
            subtotal_paise: totals.subtotal_paise,
            cgst_paise: totals.cgst_paise,
            sgst_paise: totals.sgst_paise,
            igst_paise: totals.igst_paise,
            is_interstate: interstate,
            place_of_supply_code: placeOfSupply || null,
          },
        });
      } else {
        // Tally/Busy-style continuous entry: clear and stay on the same voucher type.
        setPartyId("");
        setRefNo("");
        setNarration("");
        setLines([blankLine()]);
        setFocusedLine(0);
        setSavedTick((n) => n + 1);
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [activeCompanyId, canWrite, partyId, lines, computed, voucherType, date, refNo, narration, interstate, totals, roundOffPaise, placeOfSupply, navigate, cfg]);

  // Hotkeys: Ctrl+S save (stay & start next), F3 new ledger, Shift+F3 edit party, F4 new item, Shift+F4 edit item on focused line
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) save();
      } else if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) {
          if (partyId) setLedgerDlg({ open: true, editId: partyId });
          else toast.info("Select a party first to edit");
        } else {
          setLedgerDlg({ open: true, editId: null });
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        const itemId = lines[focusedLine]?.item_id ?? null;
        if (e.shiftKey) {
          if (itemId) setItemDlg({ open: true, editId: itemId, lineIdx: focusedLine });
          else toast.info("Pick an item on a line first to edit");
        } else {
          setItemDlg({ open: true, editId: null, lineIdx: focusedLine });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, navigate, saving, partyId, lines, focusedLine]);

  const onLedgerSaved = (lg: QuickLedger) => {
    setLedgers((cur) => {
      const without = cur.filter((x) => x.id !== lg.id);
      return [...without, { id: lg.id, name: lg.name, type: lg.type, state_code: lg.state_code }].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    });
    if (cfg.partyTypes.includes(lg.type)) setPartyId(lg.id);
  };

  const onItemSaved = (it: QuickItem) => {
    setItems((cur) => {
      const without = cur.filter((x) => x.id !== it.id);
      return [...without, it].sort((a, b) => a.name.localeCompare(b.name));
    });
    const idx = itemDlg.lineIdx;
    if (idx !== null) {
      setLines((cur) =>
        cur.map((l, i) => (i === idx ? { ...l, item_id: it.id, gst_rate: String(it.gst_rate) } : l)),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{cfg.title}</h1>
          <p className="text-xs text-muted-foreground">
            <kbd className="rounded border px-1">Ctrl+S</kbd> save & next · <kbd className="rounded border px-1">F3</kbd> new ledger · <kbd className="rounded border px-1">Shift+F3</kbd> edit party · <kbd className="rounded border px-1">F4</kbd> new item · <kbd className="rounded border px-1">Shift+F4</kbd> edit item
            {interstate && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                Interstate (IGST)
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/app/vouchers" })}>
            <X className="mr-1 h-4 w-4" /> Cancel
          </Button>
          <Button onClick={save} disabled={saving || !canWrite || locked}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <PeriodLockBanner lock={lock} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Date</Label>
            <FyDatePicker value={date} onChange={setDate} />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center justify-between">
              <span>{cfg.partyLabel}</span>
              <span className="flex gap-2">
                <button type="button" className="text-primary hover:underline text-xs inline-flex items-center gap-0.5" onClick={() => setLedgerDlg({ open: true, editId: null })} title="New ledger (F3)">
                  <UserPlus className="h-3 w-3" /> New
                </button>
                {partyId && (
                  <button type="button" className="text-primary hover:underline text-xs inline-flex items-center gap-0.5" onClick={() => setLedgerDlg({ open: true, editId: partyId })} title="Edit party (Shift+F3)">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </span>
            </Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${cfg.partyLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {partyOpts.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    No {cfg.partyLabel.toLowerCase()}s yet — press <kbd className="rounded border px-1">F3</kbd> to create.
                  </div>
                ) : (
                  partyOpts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reference No.</Label>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="PO / Bill no." />
          </div>
          <div className="space-y-1">
            <Label>Place of Supply</Label>
            <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">Item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20">Qty</TableHead>
                <TableHead className="w-24">Rate</TableHead>
                <TableHead className="w-20">Disc</TableHead>
                <TableHead className="w-20">GST %</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell onFocusCapture={() => setFocusedLine(i)} onClick={() => setFocusedLine(i)}>
                    <div className="flex gap-1">
                      <Select value={l.item_id} onValueChange={(v) => { setFocusedLine(i); onPickItem(i, v); }}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                        <SelectContent>
                          {items.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No items yet — press F4.</div>
                          ) : (
                            items.map((it) => (
                              <SelectItem key={it.id} value={it.id}>
                                {it.name} ({it.unit})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" title="New item (F4)" onClick={() => { setFocusedLine(i); setItemDlg({ open: true, editId: null, lineIdx: i }); }}>
                        <PackagePlus className="h-4 w-4" /> Add
                      </Button>
                      {l.item_id && (
                        <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" title="Edit item (Shift+F4)" onClick={() => { setFocusedLine(i); setItemDlg({ open: true, editId: l.item_id, lineIdx: i }); }}>
                          <Pencil className="h-4 w-4" /> Edit
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9"
                      value={l.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9"
                      type="number"
                      step="0.01"
                      value={l.qty}
                      onChange={(e) => updateLine(i, { qty: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9"
                      type="number"
                      step="0.01"
                      value={l.rate}
                      onChange={(e) => updateLine(i, { rate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9"
                      type="number"
                      step="0.01"
                      value={l.discount}
                      onChange={(e) => updateLine(i, { discount: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={l.gst_rate}
                      onValueChange={(v) => updateLine(i, { gst_rate: v })}
                    >
                      <SelectTrigger className="h-9">
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
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatINR(computed[i].total_paise)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={addLine}>
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <Label>Narration</Label>
            <Textarea
              rows={4}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Optional notes"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1.5 p-4 text-sm">
            <Row label="Taxable" value={formatINR(totals.subtotal_paise)} />
            {interstate ? (
              <Row label="IGST" value={formatINR(totals.igst_paise)} />
            ) : (
              <>
                <Row label="CGST" value={formatINR(totals.cgst_paise)} />
                <Row label="SGST" value={formatINR(totals.sgst_paise)} />
              </>
            )}
            <div className="my-2 border-t" />
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={roundOff}
                  onChange={(e) => setRoundOff(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Round off
              </label>
              <span className="font-mono">{roundOffPaise === 0 ? "—" : formatINR(roundOffPaise)}</span>
            </div>
            <Row label="Grand Total" value={formatINR(totals.total_paise)} bold />
            <p className="pt-2 text-xs italic text-muted-foreground">
              {amountInWords(totals.total_paise)}
            </p>
            {(voucherType === "sales" || voucherType === "purchase" || voucherType === "credit_note" || voucherType === "debit_note") && totals.total_paise > 5_000_000 && (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                <Truck className="inline h-3 w-3 mr-1" />
                Voucher value exceeds <strong>₹50,000</strong>. An <strong>E-Way Bill</strong> is mandatory for inter-state movement, and for intra-state movement beyond city limits (typically &gt; 50&nbsp;km) per state rules. The E-Way Bill prep tool will open after save.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {activeCompanyId && (
        <>
          <QuickLedgerDialog
            open={ledgerDlg.open}
            onOpenChange={(o) => setLedgerDlg((s) => ({ ...s, open: o }))}
            companyId={activeCompanyId}
            editId={ledgerDlg.editId}
            onSaved={onLedgerSaved}
          />
          <QuickItemDialog
            open={itemDlg.open}
            onOpenChange={(o) => setItemDlg((s) => ({ ...s, open: o }))}
            companyId={activeCompanyId}
            editId={itemDlg.editId}
            onSaved={onItemSaved}
          />
        </>
      )}
      <EwayBillPrepDialog
        open={ewbDlg.open}
        onOpenChange={(o) => {
          setEwbDlg((s) => ({ ...s, open: o }));
          if (!o) {
            // After E-Way prep dialog closes, reset form for the next entry
            // instead of leaving the voucher screen.
            setPartyId("");
            setRefNo("");
            setNarration("");
            setLines([blankLine()]);
            setFocusedLine(0);
          }
        }}
        voucher={ewbDlg.voucher}
      />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
