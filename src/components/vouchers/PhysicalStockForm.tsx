import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/lib/company-context";
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { useEnterAsTab } from "./useEnterAsTab";
import { useShortcut, useOptionalKeyboard } from "@/lib/keyboard";
import { NextVoucherNumberCard } from "./NextVoucherNumberCard";
import { Combo } from "./Combo";
import { getAllItems, useMastersVersion } from "@/lib/masters-cache";
import { enqueueSave } from "@/lib/save-queue";
import {
  PHYSICAL_STOCK_KEY,
  runPhysicalStockCreate,
  type ItemVoucherSnap,
} from "@/lib/offline/voucher-executors";
import { useVoucherDraft, clearVoucherDraft } from "@/hooks/useVoucherDraft";
import { DraftRecoveredBanner } from "./DraftRecoveredBanner";
import { calculateWac, type ItemMove as WacMove } from "@/lib/inventory/valuation-engine";
import {
  readItems,
  readVouchers,
  readVoucherItemsForCompany,
} from "@/lib/offline/cache-read";
import { supabase } from "@/integrations/supabase/client";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

interface ItemOpt {
  id: string;
  name: string;
  unit: string;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
}

interface StockLine {
  id: string;
  item_id: string;
  bookQty: number;
  countedQty: string;
  unit: string;
}

const blankLine = (): StockLine => ({
  id: crypto.randomUUID(),
  item_id: "",
  bookQty: 0,
  countedQty: "",
  unit: "",
});

/** Compute the current book quantity for an item as of a date. */
function computeBookQty(
  item: ItemOpt,
  moves: Array<{ item_id: string; qty: number; voucher_type: string; voucher_date: string }>,
  asOfDate: string,
): number {
  const wacMoves: WacMove[] = moves
    .filter((m) => m.item_id === item.id && m.voucher_date <= asOfDate)
    .map((m) => ({
      date: m.voucher_date,
      qty: Number(m.qty),
      taxablePaise: 0,
      type: m.voucher_type,
      voucherId: "",
    }));
  const val = calculateWac(
    Number(item.opening_stock_qty || 0),
    Number(item.opening_stock_rate_paise || 0),
    wacMoves,
  );
  return val.closingQty;
}

export function PhysicalStockForm() {
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const defaultDate = useDefaultFyDate();

  const [date, setDate] = useState(defaultDate);
  const [refNo, setRefNo] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<StockLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const { lock, locked } = usePeriodLock(date);
  const mastersVersion = useMastersVersion();

  const [items, setItems] = useState<ItemOpt[]>([]);
  const [allMoves, setAllMoves] = useState<
    Array<{ item_id: string; qty: number; voucher_type: string; voucher_date: string }>
  >([]);

  // Load items + stock movements to compute book quantities.
  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    (async () => {
      try {
        if (isLocalOnlyMode()) {
          const [itemRows, vouchers, viRows] = await Promise.all([
            readItems(activeCompanyId),
            readVouchers(activeCompanyId),
            readVoucherItemsForCompany(activeCompanyId),
          ]);
          const vById = new Map((vouchers as any[]).map((v) => [String(v.id), v]));
          const moves = (viRows as any[])
            .map((vi) => {
              const v = vById.get(String(vi.voucher_id));
              if (!v || v.is_deleted === true) return null;
              return {
                item_id: String(vi.item_id ?? ""),
                qty: Number(vi.qty ?? 0),
                voucher_type: String(v.voucher_type ?? ""),
                voucher_date: String(v.voucher_date ?? ""),
              };
            })
            .filter(Boolean) as Array<{
              item_id: string;
              qty: number;
              voucher_type: string;
              voucher_date: string;
            }>;
          if (cancelled) return;
          setItems(
            (itemRows as any[]).map((i) => ({
              id: String(i.id),
              name: String(i.name ?? ""),
              unit: String(i.unit ?? "NOS"),
              opening_stock_qty: Number(i.opening_stock_qty ?? i.opening_qty ?? 0),
              opening_stock_rate_paise: Number(i.opening_stock_rate_paise ?? 0),
            })),
          );
          setAllMoves(moves);
          return;
        }

        const [{ data: itemData }, { data: viData }] = await Promise.all([
          supabase
            .from("items")
            .select("id, name, unit, opening_stock_qty, opening_stock_rate_paise")
            .eq("company_id", activeCompanyId)
            .order("name"),
          supabase
            .from("voucher_items")
            .select("item_id, qty, voucher_id, vouchers(voucher_type, voucher_date, company_id)")
            .eq("vouchers.company_id", activeCompanyId),
        ]);
        if (cancelled) return;
        setItems((itemData ?? []) as unknown as ItemOpt[]);
        setAllMoves(
          ((viData ?? []) as any[]).map((vi) => ({
            item_id: String(vi.item_id ?? ""),
            qty: Number(vi.qty ?? 0),
            voucher_type: String(vi.vouchers?.voucher_type ?? ""),
            voucher_date: String(vi.vouchers?.voucher_date ?? ""),
          })),
        );
      } catch {
        /* ignore — form still works without book qty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, mastersVersion, savedTick]);

  // ---------- Draft persistence ----------
  const draftKey = activeCompanyId ? `voucher-draft:${activeCompanyId}:physical_stock` : null;
  const draftSnap = useMemo(
    () => ({ date, refNo, narration, lines }),
    [date, refNo, narration, lines],
  );
  const applyDraft = useCallback((d: typeof draftSnap) => {
    if (d.date) setDate(d.date);
    if (typeof d.refNo === "string") setRefNo(d.refNo);
    if (typeof d.narration === "string") setNarration(d.narration);
    if (Array.isArray(d.lines) && d.lines.length > 0) setLines(d.lines);
  }, []);
  const isDraftEmpty = useCallback((s: typeof draftSnap) => {
    const hasLine = s.lines.some((l) => l.item_id || (parseFloat(l.countedQty) || 0) !== 0);
    return !s.refNo && !s.narration && !hasLine;
  }, []);
  const draft = useVoucherDraft(draftKey, draftSnap, applyDraft, isDraftEmpty);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

  // ---------- Item selection ----------
  const itemOptions = useMemo(
    () => items.map((i) => ({ value: i.id, label: i.name, hint: i.unit })),
    [items],
  );

  const onItemChange = (idx: number, itemId: string) => {
    setLines((cur) =>
      cur.map((l, i) => {
        if (i !== idx) return l;
        const item = items.find((x) => x.id === itemId);
        const bookQty = item ? computeBookQty(item, allMoves, date) : 0;
        return {
          ...l,
          item_id: itemId,
          bookQty,
          unit: item?.unit ?? "",
          countedQty: l.countedQty || String(bookQty),
        };
      }),
    );
  };

  const onCountedChange = (idx: number, val: string) => {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, countedQty: val } : l)));
  };

  const addLine = () => setLines((c) => [...c, blankLine()]);
  const removeLine = (idx: number) =>
    setLines((c) => (c.length === 1 ? c : c.filter((_, i) => i !== idx)));

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  // ---------- Save ----------
  const performSave = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;

    const validLines = lines.filter(
      (l) => l.item_id && l.countedQty !== "" && l.countedQty !== null,
    );
    if (validLines.length === 0) {
      toast.error("Add at least one item line");
      return;
    }

    // Lines where counted != book — the actual adjustments.
    const adjLines = validLines
      .map((l) => {
        const counted = parseFloat(l.countedQty) || 0;
        const diff = counted - l.bookQty;
        return { ...l, diff };
      })
      .filter((l) => l.diff !== 0);

    if (adjLines.length === 0) {
      toast.info("No differences found — counted quantities match book stock.");
      return;
    }

    setSaving(true);

    const snap: ItemVoucherSnap = {
      companyId: activeCompanyId,
      voucherType: "physical_stock",
      voucherDate: date,
      partyId: "",
      refNo,
      narration,
      placeOfSupply: "",
      interstate: false,
      itcClass: "na",
      itcEligible: false,
      originalVoucherId: null,
      totals: {
        subtotal_paise: 0,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        round_off_paise: 0,
        total_paise: 0,
      },
      lines: adjLines.map((l, i) => ({
        l: {
          item_id: l.item_id,
          description: `Book: ${l.bookQty} → Counted: ${parseFloat(l.countedQty) || 0} (${l.unit})`,
          qty: String(l.diff),
          rate: "0",
        },
        c: {
          discount_paise: 0,
          amount_paise: 0,
          taxable_paise: 0,
          gst_rate: 0,
          cgst_paise: 0,
          sgst_paise: 0,
          igst_paise: 0,
          total_paise: 0,
        },
      })),
    };

    clearVoucherDraft(draftKey);
    setDraftBannerDismissed(true);
    setRefNo("");
    setNarration("");
    setLines([blankLine()]);
    setSavedTick((n) => n + 1);
    setSaving(false);

    enqueueSave(
      `Physical Stock ${snap.voucherDate}`,
      async () => {
        await runPhysicalStockCreate(snap);
      },
      { executor: PHYSICAL_STOCK_KEY, snap, companyId: snap.companyId },
    );

    toast.success("Physical stock voucher saved");
  }, [activeCompanyId, canWrite, lines, date, refNo, narration, draftKey]);

  const save = useCallback(() => {
    void performSave();
  }, [performSave]);

  // ---------- Keyboard shortcuts ----------
  const kb = useOptionalKeyboard();
  useEffect(() => {
    if (!kb) return;
    return kb.pushScope("voucher");
  }, [kb]);

  const saveHandler = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      if (!saving) save();
    },
    [save, saving],
  );
  useShortcut("Ctrl+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });
  useShortcut("Meta+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });
  useShortcut("Alt+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });

  useShortcut(
    "Escape",
    (e) => {
      const dirty = !isDraftEmpty(draftSnap);
      if (dirty) {
        e.preventDefault();
        const ok = window.confirm("Discard this stock-take entry? Unsaved changes will be lost.");
        if (!ok) return;
        clearVoucherDraft(draftKey);
      }
      navigate({ to: "/app/vouchers" });
    },
    { scope: "voucher", allowInField: true, description: "Cancel and return" },
  );

  const enterTab = useEnterAsTab(() => {
    if (!saving) save();
  });

  // ---------- Totals ----------
  const totalAdjustments = useMemo(() => {
    return lines.reduce((acc, l) => {
      if (!l.item_id || l.countedQty === "") return acc;
      const diff = (parseFloat(l.countedQty) || 0) - l.bookQty;
      if (diff > 0) acc.positive += diff;
      else if (diff < 0) acc.negative += Math.abs(diff);
      return acc;
    }, { positive: 0, negative: 0 });
  }, [lines]);

  return (
    <div
      className="space-y-4"
      data-fast-form
      ref={enterTab.ref}
      onKeyDown={enterTab.onKeyDown}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-white/50 px-4 py-2" style={{ borderTop: "3px solid #0ea5e9" }}>
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Physical Stock (Stock-Take)</h2>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
            <kbd className="rounded border bg-white px-1 shadow-sm">Enter</kbd> next field
            <kbd className="ml-1 rounded border bg-white px-1 shadow-sm">Ctrl+S</kbd> save
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              if (!isDraftEmpty(draftSnap)) {
                const ok = window.confirm("Discard this stock-take entry? Unsaved changes will be lost.");
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
            data-primary-action="true"
            onClick={save}
            disabled={saving || !canWrite || locked}
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
            setLines([blankLine()]);
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
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Reference No.</Label>
              <Input
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
                placeholder="Stock-take reference / sheet number"
                className="bg-white"
              />
            </div>
            <div className="md:pt-5">
              <NextVoucherNumberCard companyId={activeCompanyId} voucherType="physical_stock" refreshKey={savedTick} voucherDate={date} />
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Narration</Label>
            <Textarea
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Stock-take notes — location, counter, supervisor…"
              className="bg-white"
              rows={1}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-x-0 border-y shadow-none rounded-none bg-white">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Stock Count
            </span>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <Badge variant="secondary" className="text-[10px]">
                Surplus: +{totalAdjustments.positive}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                Shortage: -{totalAdjustments.negative}
              </Badge>
            </div>
          </div>
          <Table>
            <TableHeader className="bg-muted/10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="py-2 text-[11px] font-bold uppercase text-muted-foreground">Item</TableHead>
                <TableHead className="w-28 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Book Qty</TableHead>
                <TableHead className="w-32 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Counted Qty</TableHead>
                <TableHead className="w-28 py-2 text-right text-[11px] font-bold uppercase text-muted-foreground">Difference</TableHead>
                <TableHead className="w-16 py-2 text-[11px] font-bold uppercase text-muted-foreground">Unit</TableHead>
                <TableHead className="w-10 py-2"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, idx) => {
                const counted = parseFloat(l.countedQty) || 0;
                const diff = l.item_id ? counted - l.bookQty : 0;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="py-2">
                      <Combo
                        value={l.item_id}
                        onChange={(v) => onItemChange(idx, v)}
                        options={itemOptions}
                        placeholder="Select item…"
                        emptyText="No items found"
                      />
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm">
                      {l.item_id ? l.bookQty : "—"}
                    </TableCell>
                    <TableCell className="py-2">
                      <Input
                        type="number"
                        value={l.countedQty}
                        onChange={(e) => onCountedChange(idx, e.target.value)}
                        placeholder="0"
                        className="bg-white text-right font-mono"
                        disabled={!l.item_id}
                      />
                    </TableCell>
                    <TableCell className={`py-2 text-right font-mono text-sm font-semibold ${diff > 0 ? "text-primary" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {l.item_id ? (diff > 0 ? `+${diff}` : diff === 0 ? "0" : String(diff)) : ""}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{l.unit}</TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="border-t px-3 py-2">
            <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add Line
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Only items where counted quantity differs from book stock will be saved as adjustment lines.
        Positive differences (surplus) increase stock; negative differences (shortage) decrease it.
        Each line is valued at the running weighted-average cost — no GL postings are made.
      </p>
    </div>
  );
}
