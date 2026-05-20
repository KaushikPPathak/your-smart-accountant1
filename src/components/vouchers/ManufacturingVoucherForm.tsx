import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { BookOpen, Plus, Save, Trash2 } from "lucide-react";
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
import { FyDatePicker, useDefaultFyDate } from "@/components/ui/fy-date-picker";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { usePeriodLock, PeriodLockBanner } from "./PeriodLockBanner";
import { useEnterAsTab } from "./useEnterAsTab";
import { NextVoucherNumberCard } from "./NextVoucherNumberCard";
import { Combo } from "./Combo";
import { BomTemplateDialog } from "./BomTemplateDialog";
import { getAllItems, useMastersVersion } from "@/lib/masters-cache";
import { enqueueSave } from "@/lib/save-queue";
import { loadBomForOutput } from "@/lib/bom";

interface ItemOpt {
  id: string;
  name: string;
  unit: string;
}

interface ConsumeRow {
  id: string;
  item_id: string;
  gsm: string;
  length_cm: string;
  height_cm: string;
  weight_per_unit_g: string;
  qty: string;
  rate: string;
}

interface OutputRow {
  id: string;
  item_id: string;
  length_cm: string;
  height_cm: string;
  weight_per_unit_g: string;
  qty: string;
  rate: string;
  rate_overridden: boolean;
}

const blankConsume = (): ConsumeRow => ({
  id: crypto.randomUUID(),
  item_id: "",
  gsm: "",
  length_cm: "",
  height_cm: "",
  weight_per_unit_g: "",
  qty: "0",
  rate: "0",
});

const blankOutput = (): OutputRow => ({
  id: crypto.randomUUID(),
  item_id: "",
  length_cm: "",
  height_cm: "",
  weight_per_unit_g: "",
  qty: "0",
  rate: "0",
  rate_overridden: false,
});

const lineAmount = (qty: string, rate: string) =>
  rupeesToPaise((parseFloat(qty) || 0) * (parseFloat(rate) || 0));

export function ManufacturingVoucherForm() {
  const navigate = useNavigate();
  const { activeCompanyId, activeMembership } = useCompany();
  const defaultDate = useDefaultFyDate();

  const [date, setDate] = useState(defaultDate);
  const [department, setDepartment] = useState("");
  const [finalProductId, setFinalProductId] = useState("");
  const [qtyToProduce, setQtyToProduce] = useState("1");
  const [narration, setNarration] = useState("");
  const [consume, setConsume] = useState<ConsumeRow[]>([blankConsume()]);
  const [outputs, setOutputs] = useState<OutputRow[]>([blankOutput()]);
  const [consumeDirty, setConsumeDirty] = useState(false);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [bomDlg, setBomDlg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const { lock } = usePeriodLock(date);
  const mastersVersion = useMastersVersion();

  useEffect(() => {
    setItems(
      getAllItems().map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    );
  }, [mastersVersion, activeCompanyId]);

  // When Final Product / qty changes → seed output row + try BOM autopopulate
  useEffect(() => {
    if (!finalProductId) return;
    setOutputs((cur) => {
      const first = { ...(cur[0] ?? blankOutput()) };
      first.item_id = finalProductId;
      first.qty = qtyToProduce;
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
          gsm: l.specs?.gsm ?? "",
          length_cm: l.specs?.length_cm ?? "",
          height_cm: l.specs?.height_cm ?? "",
          weight_per_unit_g: l.specs?.weight_per_unit_g ?? "",
          qty: String(+(Number(l.qty_per_output) * scale).toFixed(4)),
          rate: "0",
        })),
      );
    });
    return () => {
      cancel = true;
    };
  }, [activeCompanyId, finalProductId, qtyToProduce, consumeDirty]);

  const totalConsumePaise = useMemo(
    () => consume.reduce((s, r) => s + lineAmount(r.qty, r.rate), 0),
    [consume],
  );
  const totalOutputQty = useMemo(
    () => outputs.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0),
    [outputs],
  );
  const costPerUnitPaise = useMemo(
    () =>
      totalOutputQty > 0 ? Math.round(totalConsumePaise / totalOutputQty) : 0,
    [totalConsumePaise, totalOutputQty],
  );

  // Auto-fill output rates from computed cost unless user overrode
  useEffect(() => {
    setOutputs((cur) =>
      cur.map((o) =>
        o.rate_overridden
          ? o
          : { ...o, rate: (costPerUnitPaise / 100).toFixed(2) },
      ),
    );
  }, [costPerUnitPaise]);

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
  const addOutput = () => setOutputs((c) => [...c, blankOutput()]);
  const removeConsume = (idx: number) => {
    setConsumeDirty(true);
    setConsume((c) => (c.length === 1 ? c : c.filter((_, i) => i !== idx)));
  };
  const removeOutput = (idx: number) =>
    setOutputs((c) => (c.length === 1 ? c : c.filter((_, i) => i !== idx)));

  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const performSave = useCallback(async () => {
    if (!activeCompanyId || !canWrite) return;
    const consumeValid = consume.filter(
      (r) => r.item_id && (parseFloat(r.qty) || 0) > 0,
    );
    if (consumeValid.length === 0) {
      toast.error("Add at least one raw-material row");
      return;
    }
    const outputValid = outputs.filter(
      (r) => r.item_id && (parseFloat(r.qty) || 0) > 0,
    );
    if (outputValid.length === 0) {
      toast.error("Add at least one finished-goods row");
      return;
    }

    const snap = {
      companyId: activeCompanyId,
      date,
      department,
      narration,
      consume: consumeValid,
      outputs: outputValid,
      totalConsumePaise,
    };

    // Reset instantly
    setFinalProductId("");
    setQtyToProduce("1");
    setDepartment("");
    setNarration("");
    setConsume([blankConsume()]);
    setOutputs([blankOutput()]);
    setConsumeDirty(false);
    setSavedTick((n) => n + 1);

    enqueueSave(`Manufacturing Journal ${snap.date}`, async () => {
      const { data: numData, error: numErr } = await supabase.rpc(
        "next_voucher_number",
        {
          _company_id: snap.companyId,
          _type: "manufacturing",
        },
      );
      if (numErr) throw numErr;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: vData, error: vErr } = await supabase
        .from("vouchers")
        .insert({
          company_id: snap.companyId,
          created_by: user.id,
          voucher_type: "manufacturing",
          voucher_number: numData as string,
          voucher_date: snap.date,
          reference_no: snap.department || null,
          narration: snap.narration || null,
          subtotal_paise: snap.totalConsumePaise,
          total_paise: snap.totalConsumePaise,
        })
        .select("id")
        .single();
      if (vErr) throw vErr;

      const specsOf = (r: ConsumeRow | OutputRow) => {
        const s: Record<string, string> = {};
        if ("gsm" in r && r.gsm) s.gsm = r.gsm;
        if (r.length_cm) s.length_cm = r.length_cm;
        if (r.height_cm) s.height_cm = r.height_cm;
        if (r.weight_per_unit_g) s.weight_per_unit_g = r.weight_per_unit_g;
        return Object.keys(s).length ? s : null;
      };

      const consumeRows = snap.consume.map((r, i) => {
        const qty = parseFloat(r.qty) || 0;
        const ratePaise = rupeesToPaise(parseFloat(r.rate) || 0);
        return {
          voucher_id: vData.id,
          item_id: r.item_id,
          line_no: i + 1,
          // Negative qty = stock OUT (consumption)
          qty: -qty,
          rate_paise: ratePaise,
          amount_paise: -Math.round(qty * ratePaise),
          taxable_paise: 0,
          gst_rate: 0,
          specs: specsOf(r) as unknown as Record<string, string>,
        };
      });

      const outputRows = snap.outputs.map((r, i) => {
        const qty = parseFloat(r.qty) || 0;
        const ratePaise = rupeesToPaise(parseFloat(r.rate) || 0);
        return {
          voucher_id: vData.id,
          item_id: r.item_id,
          line_no: snap.consume.length + i + 1,
          // Positive qty = stock IN (production)
          qty,
          rate_paise: ratePaise,
          amount_paise: Math.round(qty * ratePaise),
          taxable_paise: 0,
          gst_rate: 0,
          specs: specsOf(r) as unknown as Record<string, string>,
        };
      });

      const { error: iErr } = await supabase
        .from("voucher_items")
        .insert([...consumeRows, ...outputRows]);
      if (iErr) throw iErr;

      // GL postings: Dr Finished Goods / Cr Raw Materials (cost transfer).
      if (snap.totalConsumePaise > 0) {
        const ensureLedger = async (name: string) => {
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
              type: "stock_in_hand",
              group_code: "STOCK_IN_HAND",
            })
            .select("id")
            .single();
          if (lErr) throw lErr;
          return created.id;
        };
        const fgId = await ensureLedger("Finished Goods");
        const rmId = await ensureLedger("Raw Materials");
        const { error: eErr } = await supabase.from("voucher_entries").insert([
          {
            voucher_id: vData.id,
            ledger_id: fgId,
            line_no: 1,
            debit_paise: snap.totalConsumePaise,
            credit_paise: 0,
            narration: "Finished goods produced",
          },
          {
            voucher_id: vData.id,
            ledger_id: rmId,
            line_no: 2,
            debit_paise: 0,
            credit_paise: snap.totalConsumePaise,
            narration: "Raw materials consumed",
          },
        ]);
        if (eErr) throw eErr;
      }
    });
  }, [
    activeCompanyId,
    canWrite,
    date,
    department,
    narration,
    consume,
    outputs,
    totalConsumePaise,
  ]);

  const save = useCallback(() => {
    void performSave();
  }, [performSave]);

  // Ctrl+S / Alt+S → save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSave =
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") ||
        (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s");
      if (isSave) {
        e.preventDefault();
        e.stopPropagation();
        if (!saving) save();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, saving]);

  const enterTab = useEnterAsTab(() => {
    if (!saving) save();
  });

  const finalProductName =
    items.find((i) => i.id === finalProductId)?.name ?? "";

  return (
    <div className="space-y-4" data-fast-form ref={enterTab.ref} onKeyDown={enterTab.onKeyDown}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manufacturing Journal</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/app/vouchers" })}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="gap-1">
            <Save className="h-4 w-4" /> Save (Ctrl+S)
          </Button>
        </div>
      </div>

      <PeriodLockBanner lock={lock} />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex justify-end">
            <NextVoucherNumberCard
              companyId={activeCompanyId}
              voucherType="manufacturing"
              refreshKey={savedTick}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>Date</Label>
              <FyDatePicker value={date} onChange={setDate} />
            </div>
            <div className="space-y-1">
              <Label>Department / Section</Label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Floor A · Godown 2"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="flex items-center justify-between">
                <span>Final Product to Manufacture</span>
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
                placeholder="Select finished item"
              />
            </div>
            <div className="space-y-1">
              <Label>Quantity to Produce</Label>
              <Input
                type="number"
                step="0.01"
                value={qtyToProduce}
                onChange={(e) => setQtyToProduce(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* CONSUMPTION */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Raw Material Consumption
              </h2>
              <Button variant="outline" size="sm" onClick={addConsume} className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Item</TableHead>
                    <TableHead>GSM</TableHead>
                    <TableHead>LxH (cm)</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consume.map((r, i) => {
                    const unit = items.find((x) => x.id === r.item_id)?.unit ?? "";
                    return (
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
                        <TableCell>
                          <Input
                            className="h-9 w-16"
                            value={r.gsm}
                            onChange={(e) => updateConsume(i, { gsm: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-9 w-14"
                              type="number"
                              step="0.1"
                              value={r.length_cm}
                              onChange={(e) =>
                                updateConsume(i, { length_cm: e.target.value })
                              }
                            />
                            <span className="text-muted-foreground">×</span>
                            <Input
                              className="h-9 w-14"
                              type="number"
                              step="0.1"
                              value={r.height_cm}
                              onChange={(e) =>
                                updateConsume(i, { height_cm: e.target.value })
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {unit}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-9 w-20"
                            type="number"
                            step="0.001"
                            value={r.qty}
                            onChange={(e) => updateConsume(i, { qty: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-9 w-24"
                            type="number"
                            step="0.01"
                            value={r.rate}
                            onChange={(e) => updateConsume(i, { rate: e.target.value })}
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold">
              Total consumption: {formatINR(totalConsumePaise)}
            </div>
          </CardContent>
        </Card>

        {/* OUTPUT */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">
                Finished Goods Output
              </h2>
              <Button variant="outline" size="sm" onClick={addOutput} className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Item</TableHead>
                    <TableHead>LxH (cm)</TableHead>
                    <TableHead>Wt/u (g)</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Cost / unit</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputs.map((r, i) => (
                    <TableRow key={r.id}>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-9 w-14"
                            type="number"
                            step="0.1"
                            value={r.length_cm}
                            onChange={(e) =>
                              updateOutput(i, { length_cm: e.target.value })
                            }
                          />
                          <span className="text-muted-foreground">×</span>
                          <Input
                            className="h-9 w-14"
                            type="number"
                            step="0.1"
                            value={r.height_cm}
                            onChange={(e) =>
                              updateOutput(i, { height_cm: e.target.value })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9 w-20"
                          type="number"
                          step="0.01"
                          value={r.weight_per_unit_g}
                          onChange={(e) =>
                            updateOutput(i, { weight_per_unit_g: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9 w-20"
                          type="number"
                          step="0.001"
                          value={r.qty}
                          onChange={(e) => updateOutput(i, { qty: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9 w-24"
                          type="number"
                          step="0.01"
                          value={r.rate}
                          onChange={(e) =>
                            updateOutput(i, { rate: e.target.value, rate_overridden: true })
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
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold">
              Auto cost / unit: {formatINR(costPerUnitPaise)}
            </div>
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
