import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useDeferredValue,
  startTransition,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pencil, Plus, Save, Truck, UserPlus, X } from "lucide-react";
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
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { formatINR, rupeesToPaise, amountInWords } from "@/lib/money";
import { computeLine, sumLines, isInterstate, type GstLineResult } from "@/lib/gst";

import { buildItemVoucherPostings } from "@/lib/voucher-postings";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { useEnterAsTab } from "./useEnterAsTab";
import { RecentVouchersPanel } from "./RecentVouchersPanel";
import { NextVoucherNumberCard } from "./NextVoucherNumberCard";
import { Combo } from "./Combo";
import {
  getAllLedgers,
  getAllItems,
  upsertCachedLedger,
  upsertCachedItem,
  useMastersVersion,
} from "@/lib/masters-cache";
import { validateItemVoucher } from "@/lib/schemas/voucher";
import { enqueueSave } from "@/lib/save-queue";
import { ItemRow, type ItemRowData } from "@/components/fast-form/ItemRow";
import { rememberNarration, recallNarration } from "@/lib/recall-store";

type VoucherType =
  | "sales"
  | "purchase"
  | "credit_note"
  | "debit_note"
  | "sales_order"
  | "delivery_note"
  | "quotation";

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

type Line = ItemRowData;

const blankLine = (): Line => ({
  id: crypto.randomUUID(),
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
  const isPurchaseSide = voucherType === "purchase" || voucherType === "debit_note";
  const [itcClass, setItcClass] = useState<
    "inputs" | "capital_goods" | "input_services" | "ineligible" | "na"
  >(isPurchaseSide ? "inputs" : "na");
  const [itcEligible, setItcEligible] = useState<boolean>(true);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [companyStateCode, setCompanyStateCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusedLine, setFocusedLine] = useState<number>(0);
  const [savedTick, setSavedTick] = useState(0);
  const [ledgerDlg, setLedgerDlg] = useState<{ open: boolean; editId: string | null }>({
    open: false,
    editId: null,
  });
  const [itemDlg, setItemDlg] = useState<{
    open: boolean;
    editId: string | null;
    lineIdx: number | null;
  }>({ open: false, editId: null, lineIdx: null });
  const [ewbDlg, setEwbDlg] = useState<{
    open: boolean;
    voucher: {
      id: string;
      company_id: string;
      voucher_number: string;
      voucher_date: string;
      total_paise: number;
      subtotal_paise: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
      is_interstate: boolean;
      place_of_supply_code: string | null;
    } | null;
  }>({ open: false, voucher: null });
  const { lock, locked } = usePeriodLock(date);
  const showLineDescription = false;
  const showGstColumn = false;

  // ---------- Draft persistence (so leaving the screen doesn't lose entries) ----------
  const draftKey = activeCompanyId ? `voucher-draft:${activeCompanyId}:${voucherType}` : null;
  const draftRestored = useState(false);
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<{
        date: string;
        partyId: string;
        refNo: string;
        narration: string;
        placeOfSupply: string;
        roundOff: boolean;
        itcClass: typeof itcClass;
        itcEligible: boolean;
        lines: Line[];
      }>;
      if (d.date) setDate(d.date);
      if (d.partyId) setPartyId(d.partyId);
      if (d.refNo) setRefNo(d.refNo);
      if (d.narration) setNarration(d.narration);
      if (d.placeOfSupply) setPlaceOfSupply(d.placeOfSupply);
      if (typeof d.roundOff === "boolean") setRoundOff(d.roundOff);
      if (d.itcClass) setItcClass(d.itcClass);
      if (typeof d.itcEligible === "boolean") setItcEligible(d.itcEligible);
      if (Array.isArray(d.lines) && d.lines.length > 0) setLines(d.lines);
    } catch {
      /* ignore corrupt draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const hasContent =
      partyId ||
      refNo ||
      narration ||
      lines.some((l) => l.item_id || l.description || l.qty !== "1" || l.rate !== "0");
    if (!hasContent) {
      localStorage.removeItem(draftKey);
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            date,
            partyId,
            refNo,
            narration,
            placeOfSupply,
            roundOff,
            itcClass,
            itcEligible,
            lines,
          }),
        );
      } catch {
        /* quota — ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    draftKey,
    date,
    partyId,
    refNo,
    narration,
    placeOfSupply,
    roundOff,
    itcClass,
    itcEligible,
    lines,
  ]);
  void draftRestored;

  // Load company state once; ledgers + items come from the in-memory masters cache.
  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("companies")
      .select("state_code")
      .eq("id", activeCompanyId)
      .single()
      .then(({ data }) => setCompanyStateCode(data?.state_code ?? null));
  }, [activeCompanyId]);
  const mastersVersion = useMastersVersion();
  useEffect(() => {
    setLedgers(
      getAllLedgers().map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        state_code: l.state_code,
      })),
    );
    setItems(
      getAllItems().map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        gst_rate: i.gst_rate,
        hsn_code: i.hsn_code,
      })),
    );
  }, [mastersVersion, activeCompanyId]);

  const partyOpts = useMemo(
    () => ledgers.filter((l) => cfg.partyTypes.includes(l.type)),
    [ledgers, cfg.partyTypes],
  );
  const partyLedger = useMemo(() => ledgers.find((l) => l.id === partyId), [ledgers, partyId]);
  const interstate = isInterstate(companyStateCode, placeOfSupply || partyLedger?.state_code);

  // Place of supply is always derived from the party's GSTIN/state — no manual override.
  useEffect(() => {
    setPlaceOfSupply(partyLedger?.state_code ?? "");
  }, [partyLedger]);

  const deferredLines = useDeferredValue(lines);
  const computed: GstLineResult[] = useMemo(
    () =>
      deferredLines.map((l) =>
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
    [deferredLines, interstate],
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

  const updateLine = useCallback((idx: number, patch: Partial<Line>) => {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }, []);
  const onPickItem = useCallback(
    (idx: number, itemId: string) => {
      startTransition(() => {
        setLines((cur) => {
          const it = items.find((x) => x.id === itemId);
          const updated = cur.map((l, i) =>
            i === idx
              ? { ...l, item_id: itemId, gst_rate: it ? String(it.gst_rate) : l.gst_rate }
              : l,
          );
          if (itemId && idx === cur.length - 1) return [...updated, blankLine()];
          return updated;
        });
      });
    },
    [items],
  );
  const addLine = useCallback(() => setLines((cur) => [...cur, blankLine()]), []);
  const removeLine = useCallback((idx: number) => {
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((_, i) => i !== idx)));
  }, []);

  /** Focus the Item Combo trigger of the row at `idx` (after paint). */
  const focusRowItemCombo = useCallback((idx: number) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rows = document.querySelectorAll<HTMLTableRowElement>("tr[data-voucher-row]");
        const tr = rows[idx];
        if (!tr) return;
        const trigger = tr.querySelector<HTMLElement>('[role="combobox"]');
        trigger?.focus();
      });
    });
  }, []);

  /** Called when Enter is pressed on the last editable cell (GST) of a row. */
  const onAdvanceToNextRow = useCallback(
    (idx: number) => {
      setLines((cur) => {
        if (idx >= cur.length - 1) {
          // Last row → append and focus the new row.
          const next = [...cur, blankLine()];
          focusRowItemCombo(next.length - 1);
          return next;
        }
        focusRowItemCombo(idx + 1);
        return cur;
      });
    },
    [focusRowItemCombo],
  );

  const canWrite = activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const performSave = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;
    if (!partyId) {
      toast.error(`Select a ${cfg.partyLabel.toLowerCase()}`);
      return;
    }
    const validLines = lines.filter((l, i) => l.item_id && computed[i]?.total_paise > 0);
    if (validLines.length === 0) {
      toast.error("Add at least one item line");
      return;
    }

    // Shared validation — same schema is the source of truth for any future server fn.
    const itemRowsForValidation = lines
      .map((l, i) => {
        if (!l.item_id || computed[i].total_paise <= 0) return null;
        const c = computed[i];
        return {
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
      .filter(Boolean) as Array<Record<string, unknown>>;
    const check = validateItemVoucher({
      company_id: activeCompanyId,
      voucher_type: voucherType,
      voucher_date: date,
      party_ledger_id: partyId,
      reference_no: refNo || null,
      narration: narration || null,
      is_interstate: interstate,
      place_of_supply_code: placeOfSupply || null,
      subtotal_paise: totals.subtotal_paise,
      cgst_paise: totals.cgst_paise,
      sgst_paise: totals.sgst_paise,
      igst_paise: totals.igst_paise,
      round_off_paise: roundOffPaise,
      total_paise: totals.total_paise,
      items: itemRowsForValidation,
    });
    if (!check.ok) {
      toast.error(check.message);
      return;
    }

    // Snapshot for background save
    const snap = {
      companyId: activeCompanyId,
      voucherType,
      voucherDate: date,
      partyId,
      refNo,
      narration,
      placeOfSupply,
      interstate,
      itcClass: isPurchaseSide ? itcClass : "na",
      itcEligible: isPurchaseSide ? itcEligible : true,
      totals: { ...totals, round_off_paise: roundOffPaise },
      lines: lines
        .map((l, i) => ({ l, c: computed[i] }))
        .filter((x) => x.l.item_id && x.c?.total_paise > 0),
    };
    rememberNarration(voucherType, narration);
    // Reset form INSTANTLY
    setPartyId("");
    setRefNo("");
    setNarration("");
    setLines([blankLine()]);
    setFocusedLine(0);
    setSavedTick((n) => n + 1);
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
    enqueueSave(`${cfg.title} ${snap.voucherDate}`, async () => {
      const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
        _company_id: snap.companyId,
        _type: snap.voucherType,
      });
      if (numErr) throw numErr;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: vData, error: vErr } = await supabase
        .from("vouchers")
        .insert({
          company_id: snap.companyId,
          created_by: user.id,
          voucher_type: snap.voucherType,
          voucher_number: numData as string,
          voucher_date: snap.voucherDate,
          party_ledger_id: snap.partyId,
          reference_no: snap.refNo || null,
          narration: snap.narration || null,
          is_interstate: snap.interstate,
          subtotal_paise: snap.totals.subtotal_paise,
          cgst_paise: snap.totals.cgst_paise,
          sgst_paise: snap.totals.sgst_paise,
          igst_paise: snap.totals.igst_paise,
          round_off_paise: snap.totals.round_off_paise,
          total_paise: snap.totals.total_paise,
          place_of_supply_code: snap.placeOfSupply || null,
          itc_class: snap.itcClass,
          itc_eligible: snap.itcEligible,
        })
        .select("id")
        .single();
      if (vErr) throw vErr;
      const itemRows = snap.lines.map(({ l, c }, i) => ({
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
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: iErr } = await supabase.from("voucher_items").insert(itemRows as any);
      if (iErr) throw iErr;
      const skipPostings =
        snap.voucherType === "sales_order" ||
        snap.voucherType === "delivery_note" ||
        snap.voucherType === "quotation";
      if (!skipPostings) {
        const capitalItems =
          snap.itcClass === "capital_goods"
            ? snap.lines.map(({ l, c }) => {
                const it = items.find((x) => x.id === l.item_id);
                return {
                  name: (it?.name || l.description || "Capital Asset").trim(),
                  taxable_paise: c.taxable_paise,
                  cgst_paise: c.cgst_paise,
                  sgst_paise: c.sgst_paise,
                  igst_paise: c.igst_paise,
                };
              })
            : undefined;
        const postings = await buildItemVoucherPostings(
          snap.companyId,
          snap.voucherType as "sales" | "purchase" | "credit_note" | "debit_note",
          snap.partyId,
          snap.totals,
          {
            itcClass: snap.itcClass as
              | "inputs"
              | "capital_goods"
              | "input_services"
              | "ineligible"
              | "na",
            itcEligible: snap.itcEligible,
            capitalItems,
          },
        );
        const entryRows = postings.map((p) => ({
          voucher_id: vData.id,
          ledger_id: p.ledger_id,
          debit_paise: p.debit_paise,
          credit_paise: p.credit_paise,
          line_no: p.line_no,
        }));
        const { error: eErr } = await supabase.from("voucher_entries").insert(entryRows);
        if (eErr) throw eErr;
      }
      const movesGoods =
        snap.voucherType === "sales" ||
        snap.voucherType === "purchase" ||
        snap.voucherType === "credit_note" ||
        snap.voucherType === "debit_note";
      if (movesGoods && snap.totals.total_paise > 5_000_000) {
        setEwbDlg({
          open: true,
          voucher: {
            id: vData.id,
            company_id: snap.companyId,
            voucher_number: numData as string,
            voucher_date: snap.voucherDate,
            total_paise: snap.totals.total_paise,
            subtotal_paise: snap.totals.subtotal_paise,
            cgst_paise: snap.totals.cgst_paise,
            sgst_paise: snap.totals.sgst_paise,
            igst_paise: snap.totals.igst_paise,
            is_interstate: snap.interstate,
            place_of_supply_code: snap.placeOfSupply || null,
          },
        });
      }
    });
  }, [
    activeCompanyId,
    canWrite,
    partyId,
    lines,
    computed,
    voucherType,
    date,
    refNo,
    narration,
    interstate,
    totals,
    roundOffPaise,
    placeOfSupply,
    cfg,
  ]);

  const save = useCallback(() => {
    void performSave();
  }, [performSave]);

  // Hotkeys: Ctrl+S save (stay & start next), F3 new ledger, Shift+F3 edit party, F4 new item, Shift+F4 edit item on focused line
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") ||
        (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!saving) save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const last = recallNarration(voucherType);
        if (last) {
          setNarration(last);
          toast.message("Narration recalled");
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (lines.length > 1) removeLine(focusedLine);
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
  }, [save, navigate, saving, partyId, lines, focusedLine, voucherType, removeLine]);

  const onLedgerSaved = (lg: QuickLedger) => {
    upsertCachedLedger({
      id: lg.id,
      name: lg.name,
      type: lg.type,
      state_code: lg.state_code,
      is_active: true,
    });
    if (cfg.partyTypes.includes(lg.type)) setPartyId(lg.id);
  };

  const onItemSaved = (it: QuickItem) => {
    upsertCachedItem({
      id: it.id,
      name: it.name,
      unit: it.unit,
      gst_rate: it.gst_rate,
      hsn_code: it.hsn_code,
      is_active: true,
    });
    const idx = itemDlg.lineIdx;
    if (idx !== null) {
      setLines((cur) =>
        cur.map((l, i) =>
          i === idx ? { ...l, item_id: it.id, gst_rate: String(it.gst_rate) } : l,
        ),
      );
    }
  };

  const enterTab = useEnterAsTab(() => {
    if (!saving) save();
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div ref={enterTab.ref} onKeyDown={enterTab.onKeyDown} className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{cfg.title}</h1>
            <p className="text-xs text-muted-foreground">
              <kbd className="rounded border px-1">Enter</kbd> next field ·{" "}
              <kbd className="rounded border px-1">Ctrl+S</kbd> save & next ·{" "}
              <kbd className="rounded border px-1">F3</kbd> new ledger ·{" "}
              <kbd className="rounded border px-1">Shift+F3</kbd> edit party ·{" "}
              <kbd className="rounded border px-1">F4</kbd> new item ·{" "}
              <kbd className="rounded border px-1">Shift+F4</kbd> edit item
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

        <Card className="border-primary/20 bg-gradient-to-br from-card to-muted/30 shadow-sm">
          <CardContent className="p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto] md:items-end">
              <div className="space-y-1">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</Label>
                <FyDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{cfg.partyLabel}</span>
                  <span className="flex gap-2 normal-case">
                    <button
                      type="button"
                      className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                      onClick={() => setLedgerDlg({ open: true, editId: null })}
                      title="New ledger (F3)"
                    >
                      <UserPlus className="h-3 w-3" /> New
                    </button>
                    {partyId && (
                      <button
                        type="button"
                        className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                        onClick={() => setLedgerDlg({ open: true, editId: partyId })}
                        title="Edit party (Shift+F3)"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                  </span>
                </Label>
                <Combo
                  value={partyId}
                  onChange={setPartyId}
                  options={partyOpts.map((p) => ({
                    value: p.id,
                    label: p.name,
                    hint: p.state_code ?? undefined,
                  }))}
                  placeholder={`Select ${cfg.partyLabel.toLowerCase()}`}
                  emptyText={`No ${cfg.partyLabel.toLowerCase()}s yet — Alt+C to create`}
                  onCreate={() => setLedgerDlg({ open: true, editId: null })}
                  createLabel={`New ${cfg.partyLabel.toLowerCase()}`}
                />
                {partyLedger?.state_code && (
                  <p className="text-[11px] text-muted-foreground">
                    PoS: <span className="font-medium">{partyLedger.state_code}</span>{" "}
                    (auto from GSTIN)
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reference No.</Label>
                <Input
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                  placeholder="PO / Bill no."
                />
              </div>
              <div className="md:pb-0.5">
                <NextVoucherNumberCard
                  companyId={activeCompanyId}
                  voucherType={voucherType}
                  refreshKey={savedTick}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={showLineDescription ? "w-[32%]" : "w-[46%]"}>
                    Item
                  </TableHead>
                  {showLineDescription && <TableHead>Description</TableHead>}
                  <TableHead className="w-32">Qty / Unit</TableHead>
                  <TableHead className="w-24">Rate</TableHead>
                  <TableHead className="w-20">Disc</TableHead>
                  {showGstColumn && <TableHead className="w-20">GST %</TableHead>}
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <ItemRow
                    key={l.id}
                    idx={i}
                    row={l}
                    amountPaise={computed[i]?.total_paise ?? 0}
                    items={items}
                    canDelete={lines.length > 1}
                    onPickItem={onPickItem}
                    onCommit={updateLine}
                    onFocusRow={setFocusedLine}
                    onDelete={removeLine}
                    onAddItemDlg={(idx) => {
                      setFocusedLine(idx);
                      setItemDlg({ open: true, editId: null, lineIdx: idx });
                    }}
                    onEditItemDlg={(idx, itemId) => {
                      setFocusedLine(idx);
                      setItemDlg({ open: true, editId: itemId, lineIdx: idx });
                    }}
                    onAdvanceToNextRow={onAdvanceToNextRow}
                    showDescription={showLineDescription}
                    showGstColumn={showGstColumn}
                  />
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
                <span className="font-mono">
                  {roundOffPaise === 0 ? "—" : formatINR(roundOffPaise)}
                </span>
              </div>
              <Row label="Grand Total" value={formatINR(totals.total_paise)} bold />
              <p className="pt-2 text-xs italic text-muted-foreground">
                {amountInWords(totals.total_paise)}
              </p>
              {(voucherType === "sales" ||
                voucherType === "purchase" ||
                voucherType === "credit_note" ||
                voucherType === "debit_note") &&
                totals.total_paise > 5_000_000 && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                    <Truck className="inline h-3 w-3 mr-1" />
                    Voucher value exceeds <strong>₹50,000</strong>. An <strong>E-Way Bill</strong>{" "}
                    is mandatory for inter-state movement, and for intra-state movement beyond city
                    limits (typically &gt; 50&nbsp;km) per state rules. The E-Way Bill prep tool
                    will open after save.
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
          onOpenChange={(o) => setEwbDlg((s) => ({ ...s, open: o }))}
          voucher={ewbDlg.voucher}
        />
      </div>
      <div className="space-y-3">
        <RecentVouchersPanel voucherType={voucherType} refreshKey={savedTick} />
      </div>
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
