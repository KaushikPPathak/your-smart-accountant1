import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { QuickLedgerDialog, type QuickLedger } from "./QuickLedgerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatINR, rupeesToPaise } from "@/lib/money";
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { useEnterAsTab } from "./useEnterAsTab";
import { RecentVouchersPanel } from "./RecentVouchersPanel";
import { Combo } from "./Combo";
import { getAllLedgers, upsertCachedLedger, useMastersVersion } from "@/lib/masters-cache";
import { enqueueSave } from "@/lib/save-queue";
import { validateEntryVoucher } from "@/lib/schemas/voucher";

type EntryVoucherType = "receipt" | "payment" | "journal";

interface LedgerOpt {
  id: string;
  name: string;
  type: string;
}

interface LedgerBalanceInfo {
  paise: number; // signed: +Dr / -Cr
}

interface Line {
  ledger_id: string;
  debit: string;
  credit: string;
  narration: string;
}

/** Busy/Tally-style single-side line: one party ledger + one amount */
interface SimpleLine {
  ledger_id: string;
  amount: string;
  narration: string;
}

const blank = (): Line => ({ ledger_id: "", debit: "", credit: "", narration: "" });
const blankSimple = (): SimpleLine => ({ ledger_id: "", amount: "", narration: "" });

const CFG: Record<
  EntryVoucherType,
  { title: string; subtitle: string; defaultLines: number }
> = {
  receipt: {
    title: "Receipt Voucher",
    subtitle: "Money received — debit Cash/Bank, credit Party",
    defaultLines: 2,
  },
  payment: {
    title: "Payment Voucher",
    subtitle: "Money paid — credit Cash/Bank, debit Party/Expense",
    defaultLines: 2,
  },
  journal: {
    title: "Journal / Contra",
    subtitle: "Free double-entry — supports book-to-book (cash↔bank) too",
    defaultLines: 2,
  },
};

export function EntryVoucherForm({ voucherType }: { voucherType: EntryVoucherType }) {
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const cfg = CFG[voucherType];
  const isSimple = voucherType === "receipt" || voucherType === "payment";
  const defaultDate = useDefaultFyDate();
  const [date, setDate] = useState(defaultDate);
  useEffect(() => {
    if (!date && defaultDate) setDate(defaultDate);
  }, [defaultDate, date]);
  const [refNo, setRefNo] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    Array.from({ length: cfg.defaultLines }, blank),
  );
  const [cashBankId, setCashBankId] = useState<string>("");
  const [simpleLines, setSimpleLines] = useState<SimpleLine[]>(() =>
    Array.from({ length: 2 }, blankSimple),
  );
  const [ledgerBalances, setLedgerBalances] = useState<Record<string, LedgerBalanceInfo>>({});
  const [focusedLine, setFocusedLine] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [ledgerDlg, setLedgerDlg] = useState<{ open: boolean; editId: string | null; lineIdx: number | null }>({ open: false, editId: null, lineIdx: null });
  const { lock, locked } = usePeriodLock(date);
  const formRootRef = useRef<HTMLDivElement | null>(null);

  // Re-render when masters change so the ledger list stays fresh.
  const mastersVersion = useMastersVersion();
  const ledgers: LedgerOpt[] = useMemo(
    () => getAllLedgers().map((l) => ({ id: l.id, name: l.name, type: l.type })),
    [mastersVersion, activeCompanyId],
  );

  // Stable signature for the set of selected ledgers — prevents the balance
  // fetch from firing on every keystroke in narration/debit/credit.
  const selectedLedgerKey = useMemo(() => {
    const ids = isSimple
      ? [cashBankId, ...simpleLines.map((l) => l.ledger_id)]
      : lines.map((l) => l.ledger_id);
    return Array.from(new Set(ids.filter(Boolean))).sort().join(",");
  }, [isSimple, cashBankId, simpleLines, lines]);

  // Load closing balance only for newly-picked ledgers (scoped query, not a
  // full company-wide scan). Scales to large databases.
  useEffect(() => {
    if (!activeCompanyId) return;
    const ids = selectedLedgerKey ? selectedLedgerKey.split(",") : [];
    const missing = ids.filter((id) => id && !(id in ledgerBalances));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const [{ data: ledgerRows }, { data: entryRows }] = await Promise.all([
        supabase
          .from("ledgers")
          .select("id, opening_balance_paise, opening_balance_is_debit")
          .in("id", missing),
        supabase
          .from("voucher_entries")
          .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
          .in("ledger_id", missing)
          .eq("vouchers.company_id", activeCompanyId)
          .lte("vouchers.voucher_date", date),
      ]);
      if (cancelled) return;
      const movement = new Map<string, number>();
      for (const e of (entryRows || []) as { ledger_id: string; debit_paise: number; credit_paise: number }[]) {
        movement.set(e.ledger_id, (movement.get(e.ledger_id) || 0) + e.debit_paise - e.credit_paise);
      }
      setLedgerBalances((prev) => {
        const next = { ...prev };
        for (const lg of (ledgerRows || []) as { id: string; opening_balance_paise: number; opening_balance_is_debit: boolean }[]) {
          const ob = (lg.opening_balance_is_debit ? 1 : -1) * lg.opening_balance_paise;
          next[lg.id] = { paise: ob + (movement.get(lg.id) || 0) };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, selectedLedgerKey, date, ledgerBalances]);

  // Reset cache when date changes so balances reflect the new as-of date.
  useEffect(() => {
    setLedgerBalances({});
  }, [date]);

  const totalDr = useMemo(
    () => lines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.debit) || 0), 0),
    [lines],
  );
  const totalCr = useMemo(
    () => lines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.credit) || 0), 0),
    [lines],
  );
  const simpleTotal = useMemo(
    () => simpleLines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.amount) || 0), 0),
    [simpleLines],
  );
  const balanced = isSimple
    ? cashBankId !== "" && simpleTotal > 0 && simpleLines.some((l) => l.ledger_id && parseFloat(l.amount) > 0)
    : totalDr === totalCr && totalDr > 0;

  const cashBankOptions = useMemo(
    () => ledgers.filter((l) => l.type === "cash" || l.type === "bank"),
    [ledgers],
  );

  const update = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const add = () => setLines((cur) => [...cur, blank()]);
  const remove = (i: number) =>
    setLines((cur) => (cur.length <= 2 ? cur : cur.filter((_, idx) => idx !== i)));

  const updateSimple = (i: number, patch: Partial<SimpleLine>) =>
    setSimpleLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addSimple = () => setSimpleLines((cur) => [...cur, blankSimple()]);
  const removeSimple = (i: number) =>
    setSimpleLines((cur) => (cur.length <= 1 ? cur : cur.filter((_, idx) => idx !== i)));

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const save = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;
    let entriesToInsert: { ledger_id: string; debit_paise: number; credit_paise: number; narration: string | null; line_no: number }[] = [];
    let totalForVoucher = 0;
    let partyLedgerId: string | null = null;

    if (isSimple) {
      if (!cashBankId) {
        toast.error("Select a Cash/Bank account");
        return;
      }
      const filled = simpleLines.filter((l) => l.ledger_id && parseFloat(l.amount) > 0);
      if (filled.length < 1) {
        toast.error("Add at least one party/ledger line");
        return;
      }
      if (filled.some((l) => l.ledger_id === cashBankId)) {
        toast.error("Particulars cannot be the same as the Cash/Bank account");
        return;
      }
      totalForVoucher = filled.reduce((s, l) => s + rupeesToPaise(parseFloat(l.amount) || 0), 0);
      // Receipt: Dr Cash/Bank, Cr Party. Payment: Cr Cash/Bank, Dr Party.
      const isReceipt = voucherType === "receipt";
      entriesToInsert = [
        {
          ledger_id: cashBankId,
          debit_paise: isReceipt ? totalForVoucher : 0,
          credit_paise: isReceipt ? 0 : totalForVoucher,
          narration: null,
          line_no: 1,
        },
        ...filled.map((l, i) => ({
          ledger_id: l.ledger_id,
          debit_paise: isReceipt ? 0 : rupeesToPaise(parseFloat(l.amount) || 0),
          credit_paise: isReceipt ? rupeesToPaise(parseFloat(l.amount) || 0) : 0,
          narration: l.narration || null,
          line_no: i + 2,
        })),
      ];
      const partyLine = filled.find((l) => {
        const lg = ledgers.find((x) => x.id === l.ledger_id);
        return lg && (lg.type === "sundry_debtor" || lg.type === "sundry_creditor");
      });
      partyLedgerId = partyLine?.ledger_id ?? null;
    } else {
      const filled = lines.filter(
        (l) => l.ledger_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0),
      );
      if (filled.length < 2) {
        toast.error("At least 2 ledger lines required");
        return;
      }
      if (!balanced) {
        toast.error("Debit and Credit totals must match");
        return;
      }
      totalForVoucher = totalDr;
      entriesToInsert = filled.map((l, i) => ({
        voucher_id: "" as unknown as string, // assigned below
        ledger_id: l.ledger_id,
        line_no: i + 1,
        debit_paise: rupeesToPaise(parseFloat(l.debit) || 0),
        credit_paise: rupeesToPaise(parseFloat(l.credit) || 0),
        narration: l.narration || null,
      })) as typeof entriesToInsert;
      const partyLine = filled.find((l) => {
        const lg = ledgers.find((x) => x.id === l.ledger_id);
        return lg && (lg.type === "sundry_debtor" || lg.type === "sundry_creditor");
      });
      partyLedgerId = partyLine?.ledger_id ?? null;
    }
    // Snapshot payload then INSTANTLY reset. DB write happens in background.
    const snap = {
      companyId: activeCompanyId, voucherType,
      voucherDate: date, partyLedgerId,
      refNo, narration, total: totalForVoucher,
      entries: entriesToInsert,
    };
    // Shared validation (same schema would run server-side via createServerFn).
    const check = validateEntryVoucher({
      company_id: snap.companyId,
      voucher_type: snap.voucherType,
      voucher_date: snap.voucherDate,
      party_ledger_id: snap.partyLedgerId,
      reference_no: snap.refNo || null,
      narration: snap.narration || null,
      total_paise: snap.total,
      entries: snap.entries.map((e) => ({
        ledger_id: e.ledger_id,
        debit_paise: e.debit_paise,
        credit_paise: e.credit_paise,
        narration: e.narration ?? null,
        line_no: e.line_no,
      })),
    });
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setRefNo("");
    setNarration("");
    setLines(Array.from({ length: cfg.defaultLines }, blank));
    setSimpleLines(Array.from({ length: 2 }, blankSimple));
    setCashBankId("");
    setFocusedLine(0);
    setSavedTick((n) => n + 1);
    requestAnimationFrame(() => {
      const root = formRootRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), [role="combobox"]:not([disabled])');
      first?.focus();
    });
    enqueueSave(`${cfg.title} ${snap.refNo || snap.voucherDate}`, async () => {
      const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
        _company_id: snap.companyId, _type: snap.voucherType,
      });
      if (numErr) throw numErr;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: vData, error: vErr } = await supabase
        .from("vouchers")
        .insert({
          company_id: snap.companyId, created_by: user.id,
          voucher_type: snap.voucherType, voucher_number: numData as string,
          voucher_date: snap.voucherDate, party_ledger_id: snap.partyLedgerId,
          reference_no: snap.refNo || null, narration: snap.narration || null,
          is_interstate: false, subtotal_paise: snap.total, total_paise: snap.total,
        })
        .select("id").single();
      if (vErr) throw vErr;
      const entries = snap.entries.map((e) => ({ ...e, voucher_id: vData.id }));
      const { error: eErr } = await supabase.from("voucher_entries").insert(entries);
      if (eErr) throw eErr;
      toast.success(`${cfg.title} ${numData} saved`);
    });
  }, [activeCompanyId, canWrite, isSimple, cashBankId, simpleLines, lines, balanced, voucherType, date, refNo, narration, totalDr, ledgers, cfg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) save();
      } else if (e.key === "F3") {
        e.preventDefault();
        const lid = lines[focusedLine]?.ledger_id ?? null;
        if (e.shiftKey) {
          if (lid) setLedgerDlg({ open: true, editId: lid, lineIdx: focusedLine });
          else toast.info("Pick a ledger on a line first to edit");
        } else {
          setLedgerDlg({ open: true, editId: null, lineIdx: focusedLine });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, navigate, saving, lines, focusedLine]);

  const onLedgerSaved = (lg: QuickLedger) => {
    upsertCachedLedger({
      id: lg.id, name: lg.name, type: lg.type,
      state_code: (lg as { state_code?: string | null }).state_code ?? null,
      is_active: true,
    });
    const idx = ledgerDlg.lineIdx;
    if (idx !== null) {
      if (isSimple) {
        setSimpleLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ledger_id: lg.id } : l)));
      } else {
        setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ledger_id: lg.id } : l)));
      }
    }
  };

  const enterTab = useEnterAsTab(() => { if (!saving && balanced) save(); });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div
        ref={(el) => { enterTab.ref.current = el; formRootRef.current = el; }}
        onKeyDown={enterTab.onKeyDown}
        className="space-y-4"
      >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{cfg.title}</h1>
          <p className="text-xs text-muted-foreground">
            {cfg.subtitle} · <kbd className="rounded border px-1">Enter</kbd> next field · <kbd className="rounded border px-1">Ctrl+S</kbd> save & next · <kbd className="rounded border px-1">F3</kbd> new ledger · <kbd className="rounded border px-1">Shift+F3</kbd> edit ledger
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/app/vouchers" })}>
            <X className="mr-1 h-4 w-4" /> Cancel
          </Button>
          <Button onClick={save} disabled={saving || !canWrite || !balanced || locked}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <PeriodLockBanner lock={lock} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Date</Label>
            <FyDatePicker value={date} onChange={setDate} />
          </div>
          {isSimple && (
            <div className="space-y-1">
              <Label>{voucherType === "receipt" ? "Received In (Cash/Bank)" : "Paid From (Cash/Bank)"}</Label>
              <Combo
                value={cashBankId}
                onChange={setCashBankId}
                options={cashBankOptions.map((lg) => ({ value: lg.id, label: lg.name, hint: lg.type }))}
                placeholder="Select Cash / Bank account"
                emptyText="No Cash/Bank ledgers found"
                onCreate={() => setLedgerDlg({ open: true, editId: null, lineIdx: null })}
                createLabel="New Cash/Bank ledger"
              />
              {cashBankId && ledgerBalances[cashBankId] && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  Bal: {formatINR(Math.abs(ledgerBalances[cashBankId].paise))} {ledgerBalances[cashBankId].paise >= 0 ? "Dr" : "Cr"}
                </div>
              )}
            </div>
          )}
          <div className={`space-y-1 ${isSimple ? "" : "md:col-span-2"}`}>
            <Label>Reference No.</Label>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Cheque/UTR/Reference" />
          </div>
        </CardContent>
      </Card>

      {isSimple ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">Particulars ({voucherType === "receipt" ? "Received From" : "Paid To"})</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {simpleLines.map((l, i) => (
                  <TableRow key={i} onFocusCapture={() => setFocusedLine(i)} onClick={() => setFocusedLine(i)}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Combo
                          className="flex-1"
                          value={l.ledger_id}
                          onChange={(v) => { setFocusedLine(i); updateSimple(i, { ledger_id: v }); }}
                          options={ledgers.filter((lg) => lg.id !== cashBankId).map((lg) => ({ value: lg.id, label: lg.name, hint: lg.type }))}
                          placeholder="Select ledger"
                          emptyText="No ledgers — Alt+C to create"
                          onCreate={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: null, lineIdx: i }); }}
                          createLabel="New ledger"
                        />
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="New ledger (F3)" onClick={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: null, lineIdx: i }); }}>
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        {l.ledger_id && (
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Edit ledger (Shift+F3)" onClick={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: l.ledger_id, lineIdx: i }); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {l.ledger_id && ledgerBalances[l.ledger_id] && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                          <span>Bal:</span>
                          <span>{formatINR(Math.abs(ledgerBalances[l.ledger_id].paise))}</span>
                          <span>{ledgerBalances[l.ledger_id].paise >= 0 ? "Dr" : "Cr"}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-9 text-right font-mono"
                        type="number"
                        step="0.01"
                        value={l.amount}
                        onChange={(e) => updateSimple(i, { amount: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-9"
                        value={l.narration}
                        onChange={(e) => updateSimple(i, { narration: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeSimple(i)} disabled={simpleLines.length <= 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t p-3">
              <Button variant="ghost" size="sm" onClick={addSimple}>
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Ledger</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i} onFocusCapture={() => setFocusedLine(i)} onClick={() => setFocusedLine(i)}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Combo
                        className="flex-1"
                        value={l.ledger_id}
                        onChange={(v) => { setFocusedLine(i); update(i, { ledger_id: v }); }}
                        options={ledgers.map((lg) => ({ value: lg.id, label: lg.name, hint: lg.type }))}
                        placeholder="Select ledger"
                        emptyText="No ledgers — Alt+C to create"
                        onCreate={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: null, lineIdx: i }); }}
                        createLabel="New ledger"
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="New ledger (F3)" onClick={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: null, lineIdx: i }); }}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      {l.ledger_id && (
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Edit ledger (Shift+F3)" onClick={() => { setFocusedLine(i); setLedgerDlg({ open: true, editId: l.ledger_id, lineIdx: i }); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {l.ledger_id && ledgerBalances[l.ledger_id] && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                        <span className="text-muted-foreground/80">Bal:</span>
                        <span className={ledgerBalances[l.ledger_id].paise >= 0 ? "text-foreground" : "text-foreground"}>
                          {formatINR(Math.abs(ledgerBalances[l.ledger_id].paise))}
                        </span>
                        <span className="text-muted-foreground/80">
                          {ledgerBalances[l.ledger_id].paise >= 0 ? "Dr" : "Cr"}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9 text-right font-mono"
                      type="number"
                      step="0.01"
                      value={l.debit}
                      onChange={(e) =>
                        update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9 text-right font-mono"
                      type="number"
                      step="0.01"
                      value={l.credit}
                      onChange={(e) =>
                        update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-9"
                      value={l.narration}
                      onChange={(e) => update(i, { narration: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove(i)} disabled={lines.length <= 2}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={add}>
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <Label>Narration</Label>
            <Textarea rows={4} value={narration} onChange={(e) => setNarration(e.target.value)} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1.5 p-4 text-sm">
            {isSimple ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{voucherType === "receipt" ? "Total Received" : "Total Paid"}</span>
                  <span className="font-mono">{formatINR(simpleTotal)}</span>
                </div>
                <div className="my-2 border-t" />
                <div className={`flex justify-between text-base font-semibold ${balanced ? "text-emerald-600" : "text-muted-foreground"}`}>
                  <span>{balanced ? "Ready to save" : "Pick account & enter amount"}</span>
                  <span className="font-mono">{formatINR(simpleTotal)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Debit</span>
                  <span className="font-mono">{formatINR(totalDr)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Credit</span>
                  <span className="font-mono">{formatINR(totalCr)}</span>
                </div>
                <div className="my-2 border-t" />
                <div
                  className={`flex justify-between text-base font-semibold ${balanced ? "text-emerald-600" : "text-destructive"}`}
                >
                  <span>{balanced ? "Balanced" : "Difference"}</span>
                  <span className="font-mono">{formatINR(Math.abs(totalDr - totalCr))}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {activeCompanyId && (
        <QuickLedgerDialog
          open={ledgerDlg.open}
          onOpenChange={(o) => setLedgerDlg((s) => ({ ...s, open: o }))}
          companyId={activeCompanyId}
          editId={ledgerDlg.editId}
          onSaved={onLedgerSaved}
        />
      )}
      </div>
      <div className="space-y-3">
        <RecentVouchersPanel voucherType={voucherType} refreshKey={savedTick} />
      </div>
    </div>
  );
}
