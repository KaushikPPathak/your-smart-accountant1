import { useEffect, useMemo, useState, useCallback, useRef, useDeferredValue, startTransition } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, Save, X } from "lucide-react";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { useEnterAsTab } from "./useEnterAsTab";
import { useShortcut, useOptionalKeyboard } from "@/lib/keyboard";
import { RecentVouchersPanel } from "./RecentVouchersPanel";
import { NextVoucherNumberCard } from "./NextVoucherNumberCard";
import { Combo } from "./Combo";
import { getAllLedgers, upsertCachedLedger, useMastersVersion } from "@/lib/masters-cache";
import { enqueueSave } from "@/lib/save-queue";
import {
  ENTRY_VOUCHER_KEY,
  runEntryVoucherCreate,
  type EntryVoucherSnap,
} from "@/lib/offline/voucher-executors";
import { validateEntryVoucher } from "@/lib/schemas/voucher";
import { EntryRow } from "@/components/fast-form/EntryRow";
import { rememberNarration, recallNarration } from "@/lib/recall-store";
import { findDuplicateReference } from "@/lib/voucher-duplicate-check";
import { useVoucherDraft, clearVoucherDraft } from "@/hooks/useVoucherDraft";
import { DraftRecoveredBanner } from "./DraftRecoveredBanner";
import { useTaxTemplates } from "@/hooks/useVoucherMasters";
import type { Resolution, TaxTemplate } from "@/lib/voucher-resolver";
import { AutoTaxChip } from "./AutoTaxChip";
import { LedgerBalanceChip } from "./LedgerBalanceChip";
import { setVoucherContext, clearVoucherContext } from "@/lib/voucher-context-store";
import { BillAllocationDialog, type BillAllocation } from "./BillAllocationDialog";


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
  id: string;
  ledger_id: string;
  debit: string;
  credit: string;
  narration: string;
}

/** Single-side line: one party ledger + one amount (used for receipt/payment) */
interface SimpleLine {
  id: string;
  ledger_id: string;
  amount: string;
  narration: string;
}

const blank = (): Line => ({ id: crypto.randomUUID(), ledger_id: "", debit: "", credit: "", narration: "" });
const blankSimple = (): SimpleLine => ({ id: crypto.randomUUID(), ledger_id: "", amount: "", narration: "" });

const CFG: Record<
  EntryVoucherType,
  { title: string; subtitle: string; defaultLines: number; color: string }
> = {
  receipt: {
    title: "Receipt Voucher",
    subtitle: "Money received — debit Cash/Bank, credit Party",
    defaultLines: 10,
    color: "var(--cat-receipt)",
  },
  payment: {
    title: "Payment Voucher",
    subtitle: "Money paid — credit Cash/Bank, debit Party/Expense",
    defaultLines: 10,
    color: "var(--cat-payment)",
  },
  journal: {
    title: "Journal / Contra",
    subtitle: "Free double-entry — supports book-to-book (cash↔bank) too",
    defaultLines: 10,
    color: "var(--cat-master)",
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
  // Bill-wise adjustment: line id → allocations against open bills.
  const [allocs, setAllocs] = useState<Record<string, BillAllocation[]>>({});
  const [allocDlg, setAllocDlg] = useState<{ open: boolean; lineId: string | null }>({ open: false, lineId: null });

  const { lock, locked } = usePeriodLock(date);
  const formRootRef = useRef<HTMLDivElement | null>(null);

  // ---------- Draft persistence (crash recovery) ----------
  const draftKey = activeCompanyId ? `voucher-draft:${activeCompanyId}:${voucherType}` : null;
  const draftSnap = useMemo(
    () => ({ date, refNo, narration, cashBankId, lines, simpleLines }),
    [date, refNo, narration, cashBankId, lines, simpleLines],
  );
  const applyDraft = useCallback(
    (d: typeof draftSnap) => {
      if (d.date) setDate(d.date);
      if (typeof d.refNo === "string") setRefNo(d.refNo);
      if (typeof d.narration === "string") setNarration(d.narration);
      if (typeof d.cashBankId === "string") setCashBankId(d.cashBankId);
      if (Array.isArray(d.lines) && d.lines.length > 0) setLines(d.lines);
      if (Array.isArray(d.simpleLines) && d.simpleLines.length > 0) setSimpleLines(d.simpleLines);
    },
    [],
  );
  const isDraftEmpty = useCallback((s: typeof draftSnap) => {
    const hasEntry = s.lines.some((l) => l.ledger_id || parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0);
    const hasSimple = s.simpleLines.some((l) => l.ledger_id || parseFloat(l.amount) > 0);
    return !s.refNo && !s.narration && !s.cashBankId && !hasEntry && !hasSimple;
  }, []);
  const draft = useVoucherDraft(draftKey, draftSnap, applyDraft, isDraftEmpty);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);
  // Journal-only: manual tax-template override when auto-resolution can't
  // pin one down. Kept purely in memory — it's a UX guardrail so the user
  // consciously confirms which GST rectype this journal represents, not a
  // persisted field. Save is blocked until it's resolved.
  const [manualTaxTemplateId, setManualTaxTemplateId] = useState<string | null>(null);

  // Assistant prefill: when the AI chat drafts a Payment/Receipt, it stashes
  // the parsed JSON in sessionStorage and navigates here. Apply once on mount.
  useEffect(() => {
    if (!isSimple) return;
    void import("@/lib/voucher-intent").then(({ consumeAssistantPrefill, focusSaveButton }) => {
      const p = consumeAssistantPrefill(voucherType as "payment" | "receipt");
      if (!p) return;
      if (p.date) setDate(p.date);
      if (p.narration) setNarration(p.narration);
      if (p.refNo) setRefNo(p.refNo);
      if (p.cashBankLedgerId) setCashBankId(p.cashBankLedgerId);
      if (p.partyLedgerId || p.counterLedgerId || p.amount) {
        const targetId = p.partyLedgerId ?? p.counterLedgerId ?? "";
        setSimpleLines((prev) => {
          const next = [...prev];
          next[0] = {
            ...next[0],
            ledger_id: targetId,
            amount: p.amount ? String(p.amount) : next[0].amount,
            narration: p.narration ?? next[0].narration,
          };
          return next;
        });
      }
      focusSaveButton(document);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // IndexedDB/Cache-first for balance info. Offline mode doesn't support lte joins easily,
      // so we use a client-side fetch if online or wait for cache to populate.
      // But actually, we already have LedgerBalanceChip for live values.
      // For this form, let's keep it simple and just use the offlineDb directly.
      const { offlineDb } = await import("@/lib/offline/db");
      const results: Record<string, LedgerBalanceInfo> = {};
      
      for (const id of missing) {
        if (cancelled) return;
        const ledger = await offlineDb.cache_ledgers.get(id);
        if (!ledger) continue;
        
        const ob = (ledger.opening_balance_is_debit ? 1 : -1) * (ledger.opening_balance_paise || 0);
        
        // Sum entries up to current date
        const entries = await offlineDb.cache_voucher_entries
          .where("ledger_id")
          .equals(id)
          .toArray();
          
        const voucherIds = entries.map(e => e.voucher_id);
        const vouchers = await offlineDb.cache_vouchers
          .where("id")
          .anyOf(voucherIds)
          .filter(v => v.company_id === activeCompanyId && v.voucher_date <= date && v.is_deleted !== true)
          .toArray();
          
        const validVoucherIds = new Set(vouchers.map(v => v.id));
        const movement = entries
          .filter(e => validVoucherIds.has(e.voucher_id))
          .reduce((acc, e) => acc + (e.debit_paise || 0) - (e.credit_paise || 0), 0);
          
        results[id] = { paise: ob + movement };
      }
      
      if (!cancelled) {
        setLedgerBalances(prev => ({ ...prev, ...results }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, selectedLedgerKey, date, ledgerBalances]);

  // Reset cache when date changes so balances reflect the new as-of date.
  useEffect(() => {
    setLedgerBalances({});
  }, [date]);

  // Publish current voucher context so the status-bar balance strip stays in
  // sync while the user works on this form.
  const partyIdForStrip = isSimple ? (simpleLines[0]?.ledger_id ?? null) : null;
  useEffect(() => {
    setVoucherContext({
      partyLedgerId: partyIdForStrip || null,
      cashBankLedgerId: cashBankId || null,
      label: voucherType,
    });
    return () => clearVoucherContext();
  }, [partyIdForStrip, cashBankId, voucherType]);

  const deferredLines = useDeferredValue(lines);
  const deferredSimple = useDeferredValue(simpleLines);
  const totalDr = useMemo(
    () => deferredLines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.debit) || 0), 0),
    [deferredLines],
  );
  const totalCr = useMemo(
    () => deferredLines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.credit) || 0), 0),
    [deferredLines],
  );
  const simpleTotal = useMemo(
    () => deferredSimple.reduce((s, l) => s + rupeesToPaise(parseFloat(l.amount) || 0), 0),
    [deferredSimple],
  );
  const balanced = isSimple
    ? cashBankId !== "" && simpleTotal > 0 && simpleLines.some((l) => l.ledger_id && parseFloat(l.amount) > 0)
    : totalDr === totalCr && totalDr > 0;

  const cashBankOptions = useMemo(
    () => ledgers.filter((l) => l.type === "cash" || l.type === "bank"),
    [ledgers],
  );

  // ------------------------------------------------------------------
  // Journal GST rectype — progressive disclosure.
  // Only surfaces when the journal touches a GST tax ledger AND the
  // user has configured tax templates. Otherwise stays hidden.
  // Interstate is inferred from ledger name (IGST vs CGST/SGST).
  // ------------------------------------------------------------------
  const taxTemplates = useTaxTemplates(activeCompanyId ?? null);
  const taxResolution: Resolution<TaxTemplate> = useMemo(() => {
    if (voucherType !== "journal" || taxTemplates.length === 0) {
      return { status: "hidden", candidates: [] };
    }
    const selectedIds = new Set(lines.map((l) => l.ledger_id).filter(Boolean));
    const gstLedgers = ledgers.filter(
      (lg) => selectedIds.has(lg.id) && lg.type === "duties_taxes",
    );
    if (gstLedgers.length === 0) return { status: "hidden", candidates: [] };
    const hasIgst = gstLedgers.some((lg) => /\bIGST\b/i.test(lg.name));
    const hasCgstSgst = gstLedgers.some((lg) => /\bCGST\b|\bSGST\b/i.test(lg.name));
    // Prefer explicit signal; if only IGST → interstate, only CGST/SGST → intrastate.
    // Mixed / neither → leave undecided and show all as candidates.
    let candidates = taxTemplates;
    if (hasIgst && !hasCgstSgst) candidates = taxTemplates.filter((t) => t.is_interstate);
    else if (hasCgstSgst && !hasIgst) candidates = taxTemplates.filter((t) => !t.is_interstate);
    if (candidates.length === 0) return { status: "unresolved", candidates: [...taxTemplates] };
    if (candidates.length === 1) return { status: "auto", value: candidates[0], candidates: [...candidates] };
    return { status: "ambiguous", candidates: [...candidates] };
  }, [voucherType, taxTemplates, lines, ledgers]);
  const taxTemplateBlocksSave =
    (taxResolution.status === "ambiguous" || taxResolution.status === "unresolved") &&
    !manualTaxTemplateId;



  const update = useCallback((i: number, patch: Partial<Line>) => {
    startTransition(() =>
      setLines((cur) => {
        // Apply the user's patch first.
        let next = cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l));

        // Auto-mirror: after committing a debit/credit, if the voucher is now
        // out of balance, fill the opposite side on the first empty counterpart
        // row so the user only has to pick the ledger. Skip when the user
        // themselves is clearing the field.
        const touchedAmount =
          Object.prototype.hasOwnProperty.call(patch, "debit") ||
          Object.prototype.hasOwnProperty.call(patch, "credit");
        if (touchedAmount) {
          const totalD = next.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
          const totalC = next.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
          const diff = +(totalD - totalC).toFixed(2);
          if (diff !== 0) {
            const emptyIdx = next.findIndex(
              (l, idx) =>
                idx !== i &&
                !parseFloat(l.debit) &&
                !parseFloat(l.credit),
            );
            if (emptyIdx >= 0) {
              const amt = Math.abs(diff).toFixed(2);
              next = next.map((l, idx) =>
                idx === emptyIdx
                  ? { ...l, debit: diff < 0 ? amt : "", credit: diff > 0 ? amt : "" }
                  : l,
              );
            }
          }
        }
        return next;
      }),
    );
  }, []);
  const add = useCallback(() => setLines((cur) => [...cur, blank()]), []);
  const remove = useCallback((i: number) => {
    setLines((cur) => (cur.length <= 2 ? cur : cur.filter((_, idx) => idx !== i)));
  }, []);
  const updateSimple = useCallback((i: number, patch: Partial<SimpleLine>) => {
    startTransition(() => setSimpleLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l))));
  }, []);
  const addSimple = useCallback(() => setSimpleLines((cur) => [...cur, blankSimple()]), []);
  const removeSimple = useCallback((i: number) => {
    setSimpleLines((cur) => (cur.length <= 1 ? cur : cur.filter((_, idx) => idx !== i)));
  }, []);

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const performSave = useCallback(async () => {
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
    // Bill-wise adjustments for the party lines actually filled in.
    const allocations = isSimple
      ? simpleLines.flatMap((l) =>
          (allocs[l.id] ?? [])
            .filter((a) => a.amount_paise > 0 && l.ledger_id)
            .map((a) => ({
              invoice_voucher_id: a.invoice_voucher_id,
              ledger_id: l.ledger_id,
              amount_paise: a.amount_paise,
            })),
        )
      : [];
    // Snapshot payload then INSTANTLY reset. DB write happens in background.
    const snap = {
      companyId: activeCompanyId, voucherType,
      voucherDate: date, partyLedgerId,
      refNo, narration, total: totalForVoucher,
      entries: entriesToInsert,
      allocations,
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
    // Duplicate reference-number guard (all entry voucher types).
    // Banks reject a re-used cheque number, and a duplicate journal ref is
    // almost always a data-entry mistake — warn before we queue the save.
    if (snap.refNo) {
      const dups = await findDuplicateReference(activeCompanyId, voucherType, snap.refNo);
      if (dups.length > 0) {
        const first = dups[0];
        const label =
          voucherType === "payment"
            ? "Cheque / Reference No."
            : voucherType === "receipt"
              ? "Reference No."
              : "Journal Reference No.";
        const ok = window.confirm(
          `${label} "${snap.refNo}" was already used on ${first.voucher_date} (${dups.length} existing voucher${dups.length > 1 ? "s" : ""}).\n\n` +
            `Save anyway?`,
        );
        if (!ok) {
          toast.warning("Save cancelled — change the reference number to avoid a duplicate.");
          return;
        }
      }
    }
    rememberNarration(voucherType, narration);
    clearVoucherDraft(draftKey);
    setDraftBannerDismissed(true);
    setRefNo("");
    setNarration("");
    setLines(Array.from({ length: cfg.defaultLines }, blank));
    setSimpleLines(Array.from({ length: 2 }, blankSimple));
    setAllocs({});

    // Keep cashBankId as-is — user often enters multiple vouchers into the same book.
    setFocusedLine(0);
    setSavedTick((n) => n + 1);
    requestAnimationFrame(() => {
      const root = formRootRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), [role="combobox"]:not([disabled])');
      first?.focus();
    });
    enqueueSave(
      `${cfg.title} ${snap.refNo || snap.voucherDate}`,
      async () => {
        await runEntryVoucherCreate(snap as unknown as EntryVoucherSnap);
      },
      { executor: ENTRY_VOUCHER_KEY, snap, companyId: snap.companyId },
    );
  }, [activeCompanyId, canWrite, isSimple, cashBankId, simpleLines, lines, balanced, voucherType, date, refNo, narration, totalDr, ledgers, cfg, draftKey, allocs]);

  const save = useCallback(() => { void performSave(); }, [performSave]);

  // Push "voucher" scope while this form is mounted.
  const kb = useOptionalKeyboard();
  useEffect(() => {
    if (!kb) return;
    return kb.pushScope("voucher");
  }, [kb]);

  // Save (Ctrl+S / Cmd+S).
  const saveHandler = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    if (!saving) save();
  }, [save, saving]);
  useShortcut("Ctrl+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });
  useShortcut("Meta+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });

  // Ctrl+R — recall last narration for this voucher type.
  const recallHandler = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    const last = recallNarration(voucherType);
    if (last) { setNarration(last); toast.message("Narration recalled"); }
  }, [voucherType]);
  useShortcut("Ctrl+r", recallHandler, { scope: "voucher", allowInField: true, description: "Recall last narration" });
  useShortcut("Meta+r", recallHandler, { scope: "voucher", allowInField: true, description: "Recall last narration" });

  // Ctrl+D — delete focused line.
  const deleteLineHandler = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    if (isSimple) { if (simpleLines.length > 1) removeSimple(focusedLine); }
    else if (lines.length > 2) remove(focusedLine);
  }, [isSimple, simpleLines.length, lines.length, focusedLine, remove, removeSimple]);
  useShortcut("Ctrl+d", deleteLineHandler, { scope: "voucher", allowInField: true, description: "Delete focused line" });
  useShortcut("Meta+d", deleteLineHandler, { scope: "voucher", allowInField: true, description: "Delete focused line" });

  // F3 / Shift+F3 — new ledger / edit ledger on focused line.
  useShortcut("F3", (e) => {
    e.preventDefault();
    setLedgerDlg({ open: true, editId: null, lineIdx: focusedLine });
  }, { scope: "voucher", allowInField: true, description: "New ledger" });
  useShortcut("Shift+F3", (e) => {
    e.preventDefault();
    const lid = lines[focusedLine]?.ledger_id ?? null;
    if (lid) setLedgerDlg({ open: true, editId: lid, lineIdx: focusedLine });
    else toast.info("Pick a ledger on a line first to edit");
  }, { scope: "voucher", allowInField: true, description: "Edit ledger on focused line" });

  // Escape — guarded cancel.
  useShortcut("Escape", (e) => {
    const dirty = !isDraftEmpty(draftSnap);
    if (dirty) {
      e.preventDefault();
      const ok = window.confirm("Discard this voucher? Unsaved changes will be lost.");
      if (!ok) return;
      clearVoucherDraft(draftKey);
    }
    navigate({ to: "/app/vouchers" });
  }, { scope: "voucher", allowInField: true, description: "Cancel and return" });


  const onLedgerSaved = (lg: QuickLedger) => {
    upsertCachedLedger({
      id: lg.id, name: lg.name, type: lg.type,
      state_code: (lg as { state_code?: string | null }).state_code ?? null,
      gstin: (lg as { gstin?: string | null }).gstin ?? null,
      gst_treatment: (lg as { gst_treatment?: string | null }).gst_treatment ?? null,
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
    <div className="grid gap-4 lg:grid-cols-1 lg:has-[[data-recent-open]]:grid-cols-[minmax(0,1fr)_300px]">
      <div
        ref={(el) => { enterTab.ref.current = el; formRootRef.current = el; }}
        onKeyDown={enterTab.onKeyDown}
        className="space-y-4"
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-white/50 px-4 py-2" style={{ borderTop: `3px solid ${cfg.color}` }}>
          <div className="flex flex-col">
            <h2 className="text-xl font-bold tracking-tight text-foreground">{cfg.title}</h2>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
              <kbd className="rounded border bg-white px-1 shadow-sm">Enter</kbd> next field
              <kbd className="ml-1 rounded border bg-white px-1 shadow-sm">Ctrl+S</kbd> save
              {voucherType === "journal" && taxResolution.status !== "hidden" && (
                <div className="ml-2 inline-flex items-center">
                  <AutoTaxChip
                    resolution={taxResolution}
                    manualId={manualTaxTemplateId}
                    onManualChange={setManualTaxTemplateId}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (!isDraftEmpty(draftSnap)) {
                  const ok = window.confirm("Discard this voucher? Unsaved changes will be lost.");
                  if (!ok) return;
                  clearVoucherDraft(draftKey);
                }
                navigate({ to: "/app/vouchers" });
              }}
            >
              <X className="mr-1 h-3 w-3" /> Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 px-4 text-xs font-bold"
              data-assistant-save
              data-primary-action="true"
              onClick={save}
              disabled={saving || !canWrite || !balanced || locked || taxTemplateBlocksSave}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>


      {draft.restored && !draftBannerDismissed && (
        <DraftRecoveredBanner
          onDismiss={() => setDraftBannerDismissed(true)}
          onDiscard={() => {
            draft.discard();
            setDraftBannerDismissed(true);
            setRefNo("");
            setNarration("");
            setCashBankId("");
            setLines(Array.from({ length: cfg.defaultLines }, blank));
            setSimpleLines(Array.from({ length: 2 }, blankSimple));
          }}
        />
      )}

      <PeriodLockBanner lock={lock} />

        <Card className="border-x-0 border-y shadow-none rounded-none bg-theme-pale">
          <CardContent className="p-4">
            <div className="grid gap-6 md:grid-cols-[1fr_2fr_1fr_auto] md:items-start">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Date</Label>
                <FyDatePicker value={date} onChange={setDate} autoFocus />
              </div>
              {isSimple && (
                <div className="space-y-1.5">
                  <Label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    <span>{voucherType === "receipt" ? "Account (Dr)" : "Account (Cr)"}</span>
                  </Label>
                  <Combo
                    value={cashBankId}
                    onChange={setCashBankId}
                    options={cashBankOptions.map((lg) => ({ value: lg.id, label: lg.name, hint: lg.type }))}
                    placeholder="Select Cash / Bank account"
                    emptyText="No Cash/Bank ledgers found"
                    onCreate={() => setLedgerDlg({ open: true, editId: null, lineIdx: null })}
                    createLabel="New Cash/Bank ledger"
                  />
                  {cashBankId && (
                    <div className="pt-0.5">
                      <LedgerBalanceChip ledgerId={cashBankId} prefix="Bal" compact />
                    </div>
                  )}
                </div>
              )}
              <div className={`space-y-1.5 ${isSimple ? "" : "md:col-span-2"}`}>
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Reference No.</Label>
                <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Cheque/UTR/Reference" className="bg-white" />
              </div>

              <div className="md:pt-5">
                <NextVoucherNumberCard companyId={activeCompanyId} voucherType={voucherType} refreshKey={savedTick} voucherDate={date} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-x-0 border-y shadow-none rounded-none bg-white">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">Particulars</span>
            </div>
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-2 text-[11px] font-bold uppercase text-muted-foreground">Ledger Account</TableHead>
                  {!isSimple && <TableHead className="w-32 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Debit</TableHead>}
                  {!isSimple && <TableHead className="w-32 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Credit</TableHead>}
                  {isSimple && <TableHead className="w-40 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Amount</TableHead>}
                  <TableHead className="py-2 text-[11px] font-bold uppercase text-muted-foreground">Narration</TableHead>
                  <TableHead className="w-10 py-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isSimple
                  ? simpleLines.map((l, i) => (
                      <EntryRow
                        key={l.id}
                        mode="simple"
                        idx={i}
                        row={{ id: l.id, ledger_id: l.ledger_id, amount: l.amount, narration: l.narration }}
                        ledgerOptions={ledgers.filter((lg) => lg.id !== cashBankId)}
                        balance={ledgerBalances[l.ledger_id]}
                        canDelete={simpleLines.length > 1}
                        onCommit={(idx, patch) => updateSimple(idx, patch as Partial<SimpleLine>)}
                        onDelete={(idx) => removeSimple(idx)}
                        onFocusRow={setFocusedLine}
                        onAddLedger={(idx) => setLedgerDlg({ open: true, editId: null, lineIdx: idx })}
                        onEditLedger={(idx, lid) => setLedgerDlg({ open: true, editId: lid, lineIdx: idx })}
                      />
                    ))
                  : lines.map((l, i) => (
                      <EntryRow
                        key={l.id}
                        mode="double"
                        idx={i}
                        row={l}
                        ledgerOptions={ledgers}
                        balance={ledgerBalances[l.ledger_id]}
                        canDelete={lines.length > 2}
                        onCommit={(idx, patch) => update(idx, patch)}
                        onDelete={(idx) => remove(idx)}
                        onFocusRow={setFocusedLine}
                        onAddLedger={(idx) => setLedgerDlg({ open: true, editId: null, lineIdx: idx })}
                        onEditLedger={(idx, lid) => setLedgerDlg({ open: true, editId: lid, lineIdx: idx })}
                      />
                    ))}
              </TableBody>
            </Table>
            <div className="border-t p-3">
              <Button variant="ghost" size="sm" onClick={addSimple}>
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </div>
            {/* ---- Bill-wise adjustment against open sales / purchase bills ---- */}
            {simpleLines.some((l) => {
              const lg = ledgers.find((x) => x.id === l.ledger_id);
              return lg && (lg.type === "sundry_debtor" || lg.type === "sundry_creditor");
            }) && (
              <div className="space-y-2 border-t p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bill-wise adjustment
                </p>
                {simpleLines.map((l) => {
                  const lg = ledgers.find((x) => x.id === l.ledger_id);
                  if (!lg || (lg.type !== "sundry_debtor" && lg.type !== "sundry_creditor")) return null;
                  const rows = allocs[l.id] ?? [];
                  const adjusted = rows.reduce((s, a) => s + a.amount_paise, 0);
                  const lineAmt = rupeesToPaise(parseFloat(l.amount) || 0);
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                      <span className="font-medium">{lg.name}</span>
                      <span className="text-muted-foreground">{formatINR(lineAmt)}</span>
                      {rows.length > 0 ? (
                        <span className="font-mono text-xs text-primary">
                          {rows.map((a) => a.voucher_number).join(", ")} · {formatINR(adjusted)} adjusted
                          {lineAmt > adjusted ? ` · ${formatINR(lineAmt - adjusted)} on account` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">On account (no bill selected)</span>
                      )}
                      <Button
                        className="ml-auto"
                        size="sm"
                        variant="outline"
                        onClick={() => setAllocDlg({ open: true, lineId: l.id })}
                        disabled={lineAmt <= 0}
                      >
                        {rows.length > 0 ? "Change bills" : "Adjust bills"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>


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

      {activeCompanyId && allocDlg.lineId && (() => {
        const line = simpleLines.find((l) => l.id === allocDlg.lineId);
        const lg = line ? ledgers.find((x) => x.id === line.ledger_id) : undefined;
        if (!line || !lg || (lg.type !== "sundry_debtor" && lg.type !== "sundry_creditor")) return null;
        return (
          <BillAllocationDialog
            open={allocDlg.open}
            onOpenChange={(o) => setAllocDlg((s) => ({ ...s, open: o }))}
            companyId={activeCompanyId}
            ledgerId={lg.id}
            partyType={lg.type as "sundry_debtor" | "sundry_creditor"}
            totalAvailablePaise={rupeesToPaise(parseFloat(line.amount) || 0)}
            initial={allocs[line.id] ?? []}
            onSave={(rows) => setAllocs((cur) => ({ ...cur, [line.id]: rows }))}
          />
        );
      })()}

      </div>
      <div className="space-y-3">
        <RecentVouchersPanel voucherType={voucherType} refreshKey={savedTick} />
      </div>
    </div>
  );
}
