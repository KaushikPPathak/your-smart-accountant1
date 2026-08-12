import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Combo } from "./Combo";
import { loadBomForOutput, saveBom, type BomSpecs } from "@/lib/bom";

interface ItemOpt {
  id: string;
  name: string;
  unit: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  companyId: string;
  outputItemId: string;
  outputItemName: string;
  items: ItemOpt[];
  onSaved?: () => void;
}

interface DraftLine {
  id: string;
  input_item_id: string;
  qty_per_output: string;
  gsm: string;
  length_cm: string;
  height_cm: string;
  weight_per_unit_g: string;
}

const blank = (): DraftLine => ({
  id: crypto.randomUUID(),
  input_item_id: "",
  qty_per_output: "1",
  gsm: "",
  length_cm: "",
  height_cm: "",
  weight_per_unit_g: "",
});

export function BomTemplateDialog({
  open,
  onClose,
  companyId,
  outputItemId,
  outputItemName,
  items,
  onSaved,
}: Props) {
  const [outputQty, setOutputQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blank()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !outputItemId) return;
    setLoading(true);
    loadBomForOutput(companyId, outputItemId)
      .then((bom) => {
        if (bom) {
          setOutputQty(String(bom.template.output_qty));
          setNotes(bom.template.notes ?? "");
          setLines(
            bom.lines.length > 0
              ? bom.lines.map((l) => ({
                  id: crypto.randomUUID(),
                  input_item_id: l.input_item_id,
                  qty_per_output: String(l.qty_per_output),
                  gsm: l.specs?.gsm ?? "",
                  length_cm: l.specs?.length_cm ?? "",
                  height_cm: l.specs?.height_cm ?? "",
                  weight_per_unit_g: l.specs?.weight_per_unit_g ?? "",
                }))
              : [blank()],
          );
        } else {
          setOutputQty("1");
          setNotes("");
          setLines([blank()]);
        }
      })
      .finally(() => setLoading(false));
  }, [open, companyId, outputItemId]);

  const update = (idx: number, patch: Partial<DraftLine>) =>
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((cur) => [...cur, blank()]);
  const removeLine = (idx: number) =>
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((_, i) => i !== idx)));

  const onSave = async () => {
    const validLines = lines.filter(
      (l) => l.input_item_id && parseFloat(l.qty_per_output) > 0,
    );
    if (validLines.length === 0) {
      toast.error("Add at least one raw-material line");
      return;
    }
    setSaving(true);
    try {
      await saveBom(
        companyId,
        outputItemId,
        parseFloat(outputQty) || 1,
        notes || null,
        validLines.map((l) => {
          const specs: BomSpecs = {};
          if (l.gsm) specs.gsm = l.gsm;
          if (l.length_cm) specs.length_cm = l.length_cm;
          if (l.height_cm) specs.height_cm = l.height_cm;
          if (l.weight_per_unit_g) specs.weight_per_unit_g = l.weight_per_unit_g;
          return {
            input_item_id: l.input_item_id,
            qty_per_output: parseFloat(l.qty_per_output) || 0,
            specs: Object.keys(specs).length ? specs : null,
          };
        }),
      );
      toast.success("BOM saved");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bill of Materials — {outputItemName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Recipe yields output qty</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={outputQty}
                  onChange={(e) => setOutputQty(e.target.value)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={1}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[260px]">Raw Material</TableHead>
                    <TableHead>GSM</TableHead>
                    <TableHead>L (cm)</TableHead>
                    <TableHead>H (cm)</TableHead>
                    <TableHead>Wt/unit (g)</TableHead>
                    <TableHead>Qty / output</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Combo
                          value={l.input_item_id}
                          onChange={(v) => update(i, { input_item_id: v })}
                          options={items.map((it) => ({
                            value: it.id,
                            label: it.name,
                            hint: it.unit,
                          }))}
                          placeholder="Select raw material"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          value={l.gsm}
                          onChange={(e) => update(i, { gsm: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          type="number"
                          step="0.1"
                          value={l.length_cm}
                          onChange={(e) => update(i, { length_cm: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          type="number"
                          step="0.1"
                          value={l.height_cm}
                          onChange={(e) => update(i, { height_cm: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          type="number"
                          step="0.01"
                          value={l.weight_per_unit_g}
                          onChange={(e) =>
                            update(i, { weight_per_unit_g: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          type="number"
                          step="0.001"
                          value={l.qty_per_output}
                          onChange={(e) => update(i, { qty_per_output: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(i)}
                          disabled={lines.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || loading} className="gap-1">
            <Save className="h-4 w-4" /> Save BOM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
