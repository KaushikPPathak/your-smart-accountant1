import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { BookOpen, Plus, Save, Trash2, X, Recycle, Factory } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { useEnterAsTab } from "./useEnterAsTab";
import { useShortcut, useOptionalKeyboard } from "@/lib/keyboard";
import { NextVoucherNumberCard } from "./NextVoucherNumberCard";
import { Combo } from "./Combo";
import { BomTemplateDialog } from "./BomTemplateDialog";
import { getAllItems, useMastersVersion } from "@/lib/masters-cache";
import { enqueueSave } from "@/lib/save-queue";
import { loadBomForOutput } from "@/lib/bom";
import { findDuplicateReference } from "@/lib/voucher-duplicate-check";
import { useVoucherDraft, clearVoucherDraft } from "@/hooks/useVoucherDraft";
import { DraftRecoveredBanner } from "./DraftRecoveredBanner";

interface ItemOpt {
  id: string;
  name: string;
  unit: string;
}

interface AttrKV {
  k: string;
  v: string;
}

interface ConsumeRow {
  id: string;
  item_id: string;
  qty: string;
  rate: string;
  attrs: AttrKV[];
}

interface OutputRow {
  id: string;
  item_id: string;
  qty: string;
  rate: string;
  rate_overridden: boolean;
  is_byproduct: boolean;
  attrs: AttrKV[];
}

const blankAttrs = (): AttrKV[] => [];

const blankConsume = (): ConsumeRow => ({
  id: crypto.randomUUID(),
  item_id: "",
  qty: "0",
  rate: "0",
  attrs: blankAttrs(),
});

const blankOutput = (byproduct = false): OutputRow => ({
  id: crypto.randomUUID(),
  item_id: "",
  qty: "0",
  rate: "0",
  rate_overridden: false,
  is_byproduct: byproduct,
  attrs: blankAttrs(),
});

const lineAmount = (qty: string, rate: string) =>
  rupeesToPaise((parseFloat(qty) || 0) * (parseFloat(rate) || 0));

const attrsToObj = (a: AttrKV[]): Record<string, string> => {
  const o: Record<string, string> = {};
  a.forEach((kv) => {
    const k = kv.k.trim();
    if (k) o[k] = kv.v;
  });
  return o;
};

export function ManufacturingVoucherForm() {
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const defaultDate = useDefaultFyDate();

  // Header
  const [date, setDate] = useState(defaultDate);
  const [productionOrderNo, setProductionOrderNo] = useState("");
  const [department, setDepartment] = useState("");
  const [processTemplate, setProcessTemplate] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  // Main process driver
  const [finalProductId, setFinalProductId] = useState("");
  const [qtyToProduce, setQtyToProduce] = useState("1");

  // Sections
  const [consume, setConsume] = useState<ConsumeRow[]>([blankConsume()]);
  const [outputs, setOutputs] = useState<OutputRow[]>([blankOutput()]);
  const [consumeDirty, setConsumeDirty] = useState(false);

  // Processing
  const [processingCost, setProcessingCost] = useState("0");
  const [scrapValue, setScrapValue] = useState("0");
  const [machineParams, setMachineParams] = useState("");
  const [narration, setNarration] = useState("");

  // Misc
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [bomDlg, setBomDlg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const { lock } = usePeriodLock(date);
  const mastersVersion = useMastersVersion();

  // ---------- Draft persistence (crash recovery) ----------
  const draftKey = activeCompanyId ? `voucher-draft:${activeCompanyId}:manufacturing` : null;
  const draftSnap = useMemo(
    () => ({
      date, productionOrderNo, department, processTemplate, batchNo, expiryDate,
      finalProductId, qtyToProduce, consume, outputs, consumeDirty,
      processingCost, scrapValue, machineParams, narration,
    }),
    [date, productionOrderNo, department, processTemplate, batchNo, expiryDate,
     finalProductId, qtyToProduce, consume, outputs, consumeDirty,
     processingCost, scrapValue, machineParams, narration],
  );
  const applyDraft = useCallback((d: typeof draftSnap) => {
    if (d.date) setDate(d.date);
    if (typeof d.productionOrderNo === "string") setProductionOrderNo(d.productionOrderNo);
    if (typeof d.department === "string") setDepartment(d.department);
    if (typeof d.processTemplate === "string") setProcessTemplate(d.processTemplate);
    if (typeof d.batchNo === "string") setBatchNo(d.batchNo);
    if (typeof d.expiryDate === "string") setExpiryDate(d.expiryDate);
    if (typeof d.finalProductId === "string") setFinalProductId(d.finalProductId);
    if (typeof d.qtyToProduce === "string") setQtyToProduce(d.qtyToProduce);
    if (Array.isArray(d.consume) && d.consume.length > 0) setConsume(d.consume);
    if (Array.isArray(d.outputs) && d.outputs.length > 0) setOutputs(d.outputs);
    if (typeof d.consumeDirty === "boolean") setConsumeDirty(d.consumeDirty);
    if (typeof d.processingCost === "string") setProcessingCost(d.processingCost);
    if (typeof d.scrapValue === "string") setScrapValue(d.scrapValue);
    if (typeof d.machineParams === "string") setMachineParams(d.machineParams);
    if (typeof d.narration === "string") setNarration(d.narration);
  }, []);
  const isDraftEmpty = useCallback((s: typeof draftSnap) => {
    const hasConsume = s.consume.some((r) => r.item_id || (parseFloat(r.qty) || 0) > 0);
    const hasOutput = s.outputs.some((r) => r.item_id || (parseFloat(r.qty) || 0) > 0);
    return !s.productionOrderNo && !s.department && !s.processTemplate && !s.batchNo &&
      !s.expiryDate && !s.finalProductId && !s.narration && !s.machineParams &&
      !hasConsume && !hasOutput;
  }, []);
  const draft = useVoucherDraft(draftKey, draftSnap, applyDraft, isDraftEmpty);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

  useEffect(() => {
    setItems(
      getAllItems().map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    );
  }, [mastersVersion, activeCompanyId]);

  useEffect(() => {
    if (!finalProductId) return;
    setOutputs((cur) => {
      const first = { ...(cur[0] ?? blankOutput()) };
      first.item_id = finalProductId;
      first.qty = qtyToProduce;
      first.is_byproduct = false;
      return [first, ...cur.slice(1)];
    });
  }, [finalProductId, qtyToProduce]);

  useEffect(() => {
    if (!activeCompanyId || !finalProductId || consumeDirty) return;
    const qProduce = parseFloat(qtyToProduce) || 0;
    if (qProduce <= 0) return;
    let cancel = false;
    loadBomForOutput(activeCompanyId, finalProductId).then((bom) => {
      if (cancel || !bom || bom.lines.length === 0) return;
      const scale = qProduce / (Number(bom.template.output_qty) || 1);
      setConsume(
        bom.lines.map((l) => ({
          id: crypto.randomUUID(),
          item_id: l.input_item_id,
          qty: String(+(Number(l.qty_per_output) * scale).toFixed(4)),
          rate: "0",
          attrs: l.specs
            ? Object.entries(l.specs).map(([k, v]) => ({ k, v: String(v) }))
            : [],
        })),
      );
    });
    return () => {
      cancel = true;
    };
  }, [activeCompanyId, finalProductId, qtyToProduce, consumeDirty]);

  // ──────────────── Totals ────────────────
  const totalConsumePaise = useMemo(
    () => consume.reduce((s, r) => s + lineAmount(r.qty, r.rate), 0),
    [consume],
  );
  const processingPaise = useMemo(
    () => rupeesToPaise(parseFloat(processingCost) || 0),
    [processingCost],
  );
  const scrapPaise = useMemo(
    () => rupeesToPaise(parseFloat(scrapValue) || 0),
    [scrapValue],
  );

  const mainOutputs = useMemo(() => outputs.filter((o) => !o.is_byproduct), [outputs]);
  const byproductOutputs = useMemo(() => outputs.filter((o) => o.is_byproduct), [outputs]);

  const totalMainOutputQty = useMemo(
    () => mainOutputs.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0),
    [mainOutputs],
  );

  // Cost = (Input + Overhead - Scrap Recovered) / main output qty
  const costPerUnitPaise = useMemo(() => {
    if (totalMainOutputQty <= 0) return 0;
    const net = totalConsumePaise + processingPaise - scrapPaise;
    return Math.max(0, Math.round(net / totalMainOutputQty));
  }, [totalConsumePaise, processingPaise, scrapPaise, totalMainOutputQty]);

  const totalInputQty = useMemo(
    () => consume.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0),
    [consume],
  );
  const totalOutputQty = useMemo(
    () => outputs.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0),
    [outputs],
  );
  const yieldPct = totalInputQty > 0 ? (totalOutputQty / totalInputQty) * 100 : 0;
  const lossPct = Math.max(0, 100 - yieldPct);

  // Auto-fill main output rates
  useEffect(() => {
    setOutputs((cur) =>
      cur.map((o) =>
        o.is_byproduct || o.rate_overridden
          ? o
          : { ...o, rate: (costPerUnitPaise / 100).toFixed(2) },
      ),
    );
  }, [costPerUnitPaise]);

  // ──────────────── Mutators ────────────────
  const updateConsume = useCallback((idx: number, patch: Partial<ConsumeRow>) => {
    setConsumeDirty(true);
    setConsume((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);
  const updateOutput = useCallback((idx: number, patch: Partial<OutputRow>) => {
    setOutputs((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);
  const addConsume = () => {
    setConsumeDirty(true);
    setConsume((c) => [...c, blankConsume()]);
  };
  const addOutput = (byproduct = false) =>
    setOutputs((c) => [...c, blankOutput(byproduct)]);
  const removeConsume = (idx: number) => {
    setConsumeDirty(true);
    setConsume((c) => (c.length === 1 ? c : c.filter((_, i) => i !== idx)));
  };
  const removeOutput = (idx: number) =>
    setOutputs((c) => (c.length === 1 ? c : c.filter((_, i) => i !== idx)));

  const addAttrConsume = (idx: number) =>
    updateConsume(idx, { attrs: [...consume[idx].attrs, { k: "", v: "" }] });
  const addAttrOutput = (idx: number) =>
    updateOutput(idx, { attrs: [...outputs[idx].attrs, { k: "", v: "" }] });

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  // ──────────────── Save ────────────────
  const performSave = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;
    const consumeValid = consume.filter(
      (r) => r.item_id && (parseFloat(r.qty) || 0) > 0,
    );
    if (consumeValid.length === 0) {
      toast.error("Add at least one input row");
      return;
    }
    const outputValid = outputs.filter(
      (r) => r.item_id && (parseFloat(r.qty) || 0) > 0,
    );
    if (outputValid.length === 0) {
      toast.error("Add at least one output row");
      return;
    }
    const hasMain = outputValid.some((r) => !r.is_byproduct);
    if (!hasMain) {
      toast.error("At least one output must be a Finished Good (not byproduct)");
      return;
    }

    // Duplicate Production Order No. guard — a repeated PO is almost always
    // a mistake (two vouchers for the same batch).
    if (productionOrderNo) {
      const dups = await findDuplicateReference(activeCompanyId, "manufacturing", productionOrderNo);
      if (dups.length > 0) {
        const first = dups[0];
        const ok = window.confirm(
          `Production Order "${productionOrderNo}" was already used on ${first.voucher_date} (${dups.length} existing voucher${dups.length > 1 ? "s" : ""}).\n\nSave anyway?`,
        );
        if (!ok) {
          toast.warning("Save cancelled — change the Production Order No. to avoid a duplicate.");
          return;
        }
      }
    }

    setSaving(true);

    const headerMeta: Record<string, string> = {};
    if (productionOrderNo) headerMeta.production_order_no = productionOrderNo;
    if (processTemplate) headerMeta.process_template = processTemplate;
    if (batchNo) headerMeta.batch_no = batchNo;
    if (expiryDate) headerMeta.expiry_date = expiryDate;
    if (machineParams) headerMeta.machine_params = machineParams;
    const composedNarration = [
      narration,
      batchNo ? `Batch: ${batchNo}` : "",
      expiryDate ? `Expiry: ${expiryDate}` : "",
      processTemplate ? `Recipe: ${processTemplate}` : "",
      machineParams ? `Params: ${machineParams}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const snap = {
      companyId: activeCompanyId,
      date,
      department,
      productionOrderNo,
      composedNarration,
      consume: consumeValid,
      outputs: outputValid,
      totalConsumePaise,
      processingPaise,
      scrapPaise,
      headerMeta,
    };

    // Reset
    clearVoucherDraft(draftKey);
    setDraftBannerDismissed(true);
    setFinalProductId("");
    setQtyToProduce("1");
    setProductionOrderNo("");
    setProcessTemplate("");
    setBatchNo("");
    setExpiryDate("");
    setDepartment("");
    setNarration("");
    setMachineParams("");
    setProcessingCost("0");
    setScrapValue("0");
    setConsume([blankConsume()]);
    setOutputs([blankOutput()]);
    setConsumeDirty(false);
    setSavedTick((n) => n + 1);
    setSaving(false);

    enqueueSave(`Manufacturing Journal ${snap.date}`, async () => {
      const { data: numData, error: numErr } = await supabase.rpc(
        "next_voucher_number",
        { _company_id: snap.companyId, _type: "manufacturing" },
      );
      if (numErr) throw numErr;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const totalCostTransfer =
        snap.totalConsumePaise + snap.processingPaise - snap.scrapPaise;

      const { data: vData, error: vErr } = await supabase
        .from("vouchers")
        .insert({
          company_id: snap.companyId,
          created_by: user.id,
          voucher_type: "manufacturing",
          voucher_number: numData as string,
          voucher_date: snap.date,
          reference_no: snap.productionOrderNo || snap.department || null,
          narration: snap.composedNarration || null,
          subtotal_paise: snap.totalConsumePaise,
          total_paise: Math.max(0, totalCostTransfer),
        })
        .select("id")
        .single();
      if (vErr) throw vErr;

      const consumeRows = snap.consume.map((r, i) => {
        const qty = parseFloat(r.qty) || 0;
        const ratePaise = rupeesToPaise(parseFloat(r.rate) || 0);
        const specs = {
          ...attrsToObj(r.attrs),
          ...snap.headerMeta,
          flow: "input",
        };
        return {
          voucher_id: vData.id,
          item_id: r.item_id,
          line_no: i + 1,
          qty: -qty,
          rate_paise: ratePaise,
          amount_paise: -Math.round(qty * ratePaise),
          taxable_paise: 0,
          gst_rate: 0,
          specs: specs as unknown as Record<string, string>,
        };
      });

      const outputRows = snap.outputs.map((r, i) => {
        const qty = parseFloat(r.qty) || 0;
        const ratePaise = rupeesToPaise(parseFloat(r.rate) || 0);
        const specs = {
          ...attrsToObj(r.attrs),
          ...snap.headerMeta,
          flow: r.is_byproduct ? "byproduct" : "output",
        };
        return {
          voucher_id: vData.id,
          item_id: r.item_id,
          line_no: snap.consume.length + i + 1,
          qty,
          rate_paise: ratePaise,
          amount_paise: Math.round(qty * ratePaise),
          taxable_paise: 0,
          gst_rate: 0,
          specs: specs as unknown as Record<string, string>,
        };
      });

      const { error: iErr } = await supabase
        .from("voucher_items")
        .insert([...consumeRows, ...outputRows]);
      if (iErr) throw iErr;

      // GL postings
      const ensureLedger = async (
        name: string,
        type: "stock_in_hand" | "expense_direct" | "income_indirect",
        groupCode: string,
      ) => {
        const { data: existing } = await supabase
          .from("ledgers")
          .select("id")
          .eq("company_id", snap.companyId)
          .ilike("name", name)
          .limit(1)
          .maybeSingle();
        if (existing?.id) return existing.id;
        const { data: created, error: lErr } = await supabase
          .from("ledgers")
          .insert({
            company_id: snap.companyId,
            name,
            type,
            group_code: groupCode,
          })
          .select("id")
          .single();
        if (lErr) throw lErr;
        return created.id;
      };

      if (totalCostTransfer > 0) {
        const fgId = await ensureLedger(
          "Finished Goods",
          "stock_in_hand",
          "STOCK_IN_HAND",
        );
        const rmId = await ensureLedger(
          "Raw Materials",
          "stock_in_hand",
          "STOCK_IN_HAND",
        );
        const entries: Array<{
          voucher_id: string;
          ledger_id: string;
          line_no: number;
          debit_paise: number;
          credit_paise: number;
          narration: string;
        }> = [
          {
            voucher_id: vData.id,
            ledger_id: fgId,
            line_no: 1,
            debit_paise: totalCostTransfer,
            credit_paise: 0,
            narration: "Finished goods produced (incl. overhead, net of scrap)",
          },
          {
            voucher_id: vData.id,
            ledger_id: rmId,
            line_no: 2,
            debit_paise: 0,
            credit_paise: snap.totalConsumePaise,
            narration: "Raw materials consumed",
          },
        ];

        if (snap.processingPaise > 0) {
          const overheadId = await ensureLedger(
            "Processing Overhead Absorbed",
            "expense_direct",
            "DIRECT_EXPENSES",
          );
          entries.push({
            voucher_id: vData.id,
            ledger_id: overheadId,
            line_no: 3,
            debit_paise: 0,
            credit_paise: snap.processingPaise,
            narration: "Processing overhead absorbed into production",
          });
        }

        if (snap.scrapPaise > 0) {
          const scrapId = await ensureLedger(
            "Scrap / Byproduct Recovery",
            "income_indirect",
            "INDIRECT_INCOMES",
          );
          entries.push({
            voucher_id: vData.id,
            ledger_id: scrapId,
            line_no: 4,
            debit_paise: snap.scrapPaise,
            credit_paise: 0,
            narration: "Scrap value recovered (reduces FG cost)",
          });
          // Need to balance: scrap Dr added, but FG Dr already includes -scrap.
          // Re-balance: FG Dr = consume+overhead-scrap; Cr = consume+overhead.
          // So we Cr overhead/RM total above = consume + overhead.
          // Dr side currently = (consume+overhead-scrap) + scrap = consume+overhead. ✓
        }

        const { error: eErr } = await supabase
          .from("voucher_entries")
          .insert(entries);
        if (eErr) throw eErr;
      }
    });
  }, [
    activeCompanyId,
    canWrite,
    date,
    department,
    productionOrderNo,
    processTemplate,
    batchNo,
    expiryDate,
    machineParams,
    narration,
    consume,
    outputs,
    totalConsumePaise,
    processingPaise,
    scrapPaise,
    draftKey,
  ]);

  const save = useCallback(() => {
    void performSave();
  }, [performSave]);

  // Save shortcuts (Ctrl+S / Cmd+S / Alt+S). Fire even while typing.
  const saveHandler = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!saving) save();
  }, [save, saving]);
  useShortcut("Ctrl+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });
  useShortcut("Meta+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });
  useShortcut("Alt+s", saveHandler, { scope: "voucher", allowInField: true, description: "Save voucher" });

  // Escape: confirm-discard when dirty, then leave the form.
  useShortcut(
    "Escape",
    (e) => {
      const dirty = !isDraftEmpty(draftSnap);
      if (dirty) {
        e.preventDefault();
        const ok = window.confirm("Discard this manufacturing entry? Unsaved changes will be lost.");
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

  const finalProductName =
    items.find((i) => i.id === finalProductId)?.name ?? "";

  return (
    <div
      className="space-y-4"
      data-fast-form
      ref={enterTab.ref}
      onKeyDown={enterTab.onKeyDown}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Manufacturing &amp; Processing Journal</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (!isDraftEmpty(draftSnap)) {
                const ok = window.confirm("Discard this manufacturing entry? Unsaved changes will be lost.");
                if (!ok) return;
                clearVoucherDraft(draftKey);
              }
              navigate({ to: "/app/vouchers" });
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="gap-1" data-primary-action="true">
            <Save className="h-4 w-4" /> Save (Ctrl+S)
          </Button>
        </div>
      </div>

      {draft.restored && !draftBannerDismissed && (
        <DraftRecoveredBanner
          onDismiss={() => setDraftBannerDismissed(true)}
          onDiscard={() => {
            draft.discard();
            setDraftBannerDismissed(true);
            setFinalProductId("");
            setQtyToProduce("1");
            setProductionOrderNo("");
            setProcessTemplate("");
            setBatchNo("");
            setExpiryDate("");
            setDepartment("");
            setNarration("");
            setMachineParams("");
            setProcessingCost("0");
            setScrapValue("0");
            setConsume([blankConsume()]);
            setOutputs([blankOutput()]);
            setConsumeDirty(false);
          }}
        />
      )}

      <PeriodLockBanner lock={lock} />

      {/* HEADER */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex justify-end">
            <NextVoucherNumberCard
              companyId={activeCompanyId}
              voucherType="manufacturing"
              refreshKey={savedTick}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1">
              <Label>Date</Label>
              <FyDatePicker value={date} onChange={setDate} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Production Order No</Label>
              <Input
                value={productionOrderNo}
                onChange={(e) => setProductionOrderNo(e.target.value)}
                placeholder="PO-2026-001"
              />
            </div>
            <div className="space-y-1">
              <Label>Department / Warehouse</Label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Floor A · Godown 2"
              />
            </div>
            <div className="space-y-1">
              <Label>Process / Recipe Template</Label>
              <Input
                value={processTemplate}
                onChange={(e) => setProcessTemplate(e.target.value)}
                placeholder="e.g. Citrus Blend v3"
              />
            </div>
            <div className="space-y-1">
              <Label>Batch / Lot Number</Label>
              <Input
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder="LOT-A23"
              />
            </div>
            <div className="space-y-1">
              <Label>Expiry Date</Label>
              <FyDatePicker value={expiryDate} onChange={setExpiryDate} unrestricted />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label className="flex items-center justify-between">
                <span>Primary Finished Good</span>
                {finalProductId && (
                  <button
                    type="button"
                    className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                    onClick={() => setBomDlg(true)}
                  >
                    <BookOpen className="h-3 w-3" /> Manage BOM
                  </button>
                )}
              </Label>
              <Combo
                value={finalProductId}
                onChange={(v) => {
                  setConsumeDirty(false);
                  setFinalProductId(v);
                }}
                options={items.map((it) => ({
                  value: it.id,
                  label: it.name,
                  hint: it.unit,
                }))}
                placeholder="Select primary output item"
              />
            </div>
            <div className="space-y-1">
              <Label>Quantity to Produce</Label>
              <Input
                type="number"
                step="0.001"
                value={qtyToProduce}
                onChange={(e) => setQtyToProduce(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* INPUT */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Raw Materials &amp; Ingredients Consumed
              </h2>
              <Button variant="outline" size="sm" onClick={addConsume} className="gap-1">
                <Plus className="h-4 w-4" /> Add input
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Item</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Qty consumed</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consume.map((r, i) => {
                    const unit =
                      items.find((x) => x.id === r.item_id)?.unit ?? "—";
                    return (
                      <>
                        <TableRow key={r.id}>
                          <TableCell>
                            <Combo
                              value={r.item_id}
                              onChange={(v) => updateConsume(i, { item_id: v })}
                              options={items.map((it) => ({
                                value: it.id,
                                label: it.name,
                                hint: it.unit,
                              }))}
                              placeholder="Item"
                            />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {unit}
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-9 w-24"
                              type="number"
                              step="0.001"
                              value={r.qty}
                              onChange={(e) =>
                                updateConsume(i, { qty: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-9 w-24"
                              type="number"
                              step="0.01"
                              value={r.rate}
                              onChange={(e) =>
                                updateConsume(i, { rate: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatINR(lineAmount(r.qty, r.rate))}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeConsume(i)}
                              disabled={consume.length === 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow key={`${r.id}-attrs`} className="bg-muted/30">
                          <TableCell colSpan={6} className="py-1.5">
                            <AttrEditor
                              attrs={r.attrs}
                              onChange={(attrs) => updateConsume(i, { attrs })}
                              onAdd={() => addAttrConsume(i)}
                              placeholder="e.g. Grade, Purity %, Brix, Moisture"
                            />
                          </TableCell>
                        </TableRow>
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold">
              Total input value: {formatINR(totalConsumePaise)}
            </div>
          </CardContent>
        </Card>

        {/* OUTPUT */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Finished Goods &amp; Byproducts
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addOutput(false)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" /> FG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addOutput(true)}
                  className="gap-1"
                >
                  <Recycle className="h-4 w-4" /> Byproduct
                </Button>
              </div>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Item</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Qty produced</TableHead>
                    <TableHead>Unit cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputs.map((r, i) => {
                    const unit =
                      items.find((x) => x.id === r.item_id)?.unit ?? "—";
                    return (
                      <>
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <Combo
                                value={r.item_id}
                                onChange={(v) => updateOutput(i, { item_id: v })}
                                options={items.map((it) => ({
                                  value: it.id,
                                  label: it.name,
                                  hint: it.unit,
                                }))}
                                placeholder="Item"
                              />
                              {r.is_byproduct && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Byproduct / Scrap
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {unit}
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-9 w-24"
                              type="number"
                              step="0.001"
                              value={r.qty}
                              onChange={(e) =>
                                updateOutput(i, { qty: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-9 w-24"
                              type="number"
                              step="0.01"
                              value={r.rate}
                              onChange={(e) =>
                                updateOutput(i, {
                                  rate: e.target.value,
                                  rate_overridden: true,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatINR(lineAmount(r.qty, r.rate))}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeOutput(i)}
                              disabled={outputs.length === 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow key={`${r.id}-attrs`} className="bg-muted/30">
                          <TableCell colSpan={6} className="py-1.5">
                            <AttrEditor
                              attrs={r.attrs}
                              onChange={(attrs) => updateOutput(i, { attrs })}
                              onAdd={() => addAttrOutput(i)}
                              placeholder="e.g. Pack size, Colour, Grade, Spec"
                            />
                          </TableCell>
                        </TableRow>
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold">
              Auto cost / unit (FG): {formatINR(costPerUnitPaise)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PROCESSING + RECONCILIATION */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">
              Processing / Transformation
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Added Processing Cost (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={processingCost}
                  onChange={(e) => setProcessingCost(e.target.value)}
                  placeholder="Labour + electricity + machine"
                />
                <p className="text-[11px] text-muted-foreground">
                  Loaded onto finished goods cost.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Scrap Value Recovered (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={scrapValue}
                  onChange={(e) => setScrapValue(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-[11px] text-muted-foreground">
                  Reduces unit cost of finished goods.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Machine Parameters / Process Log</Label>
              <Textarea
                rows={2}
                value={machineParams}
                onChange={(e) => setMachineParams(e.target.value)}
                placeholder="Temp: 80°C · Mixing: 45 min · Pressure: 2 bar"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">
              Yield Reconciliation
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Total input qty" value={totalInputQty.toFixed(3)} />
              <Stat label="Total output qty" value={totalOutputQty.toFixed(3)} />
              <Stat
                label="Yield %"
                value={`${yieldPct.toFixed(2)}%`}
                tone={yieldPct >= 95 ? "good" : yieldPct >= 80 ? "warn" : "bad"}
              />
              <Stat
                label="Loss %"
                value={`${lossPct.toFixed(2)}%`}
                tone={lossPct <= 5 ? "good" : lossPct <= 20 ? "warn" : "bad"}
              />
            </div>
            <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/30">
              <Row k="Inputs value" v={formatINR(totalConsumePaise)} />
              <Row k="+ Processing overhead" v={formatINR(processingPaise)} />
              <Row k="− Scrap recovered" v={formatINR(scrapPaise)} />
              <div className="h-px bg-border my-1" />
              <Row
                k="Net cost to transfer"
                v={formatINR(
                  Math.max(0, totalConsumePaise + processingPaise - scrapPaise),
                )}
                bold
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              On save: outputs are stock-IN, inputs stock-OUT. GL: Dr Finished
              Goods · Cr Raw Materials · Cr Processing Overhead · Dr Scrap
              Recovery (when applicable).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label>Narration</Label>
          <Textarea
            rows={2}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Notes about this production batch…"
          />
        </CardContent>
      </Card>

      {activeCompanyId && finalProductId && (
        <BomTemplateDialog
          open={bomDlg}
          onClose={() => setBomDlg(false)}
          companyId={activeCompanyId}
          outputItemId={finalProductId}
          outputItemName={finalProductName}
          items={items}
          onSaved={() => setConsumeDirty(false)}
        />
      )}
    </div>
  );
}

function AttrEditor({
  attrs,
  onChange,
  onAdd,
  placeholder,
}: {
  attrs: AttrKV[];
  onChange: (a: AttrKV[]) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  if (attrs.length === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <Plus className="h-3 w-3" /> Add attribute ({placeholder})
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attrs.map((kv, j) => (
        <div
          key={j}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5"
        >
          <Input
            className="h-6 w-24 text-xs border-0 px-1 focus-visible:ring-0"
            value={kv.k}
            placeholder="key"
            onChange={(e) => {
              const next = [...attrs];
              next[j] = { ...kv, k: e.target.value };
              onChange(next);
            }}
          />
          <span className="text-muted-foreground">:</span>
          <Input
            className="h-6 w-24 text-xs border-0 px-1 focus-visible:ring-0"
            value={kv.v}
            placeholder="value"
            onChange={(e) => {
              const next = [...attrs];
              next[j] = { ...kv, v: e.target.value };
              onChange(next);
            }}
          />
          <button
            type="button"
            onClick={() => onChange(attrs.filter((_, k) => k !== j))}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <Plus className="h-3 w-3" /> add
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono ${toneCls}`}>{value}</div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between ${bold ? "font-semibold" : "text-muted-foreground"}`}
    >
      <span>{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
