import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { UNITS, GST_RATES } from "@/lib/constants";
import { useEnterAsTab } from "./useEnterAsTab";

export interface QuickItem {
  id: string;
  name: string;
  unit: string;
  gst_rate: number;
  hsn_code: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  editId?: string | null;
  onSaved: (item: QuickItem) => void;
}

export function QuickItemDialog({ open, onOpenChange, companyId, editId, onSaved }: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("NOS");
  const [gstRate, setGstRate] = useState("18");
  const [hsn, setHsn] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editId) {
      supabase
        .from("items")
        .select("name, unit, gst_rate, hsn_code")
        .eq("id", editId)
        .single()
        .then(({ data }) => {
          if (data) {
            setName(data.name);
            setUnit(data.unit);
            setGstRate(String(data.gst_rate));
            setHsn(data.hsn_code || "");
          }
        });
    } else {
      setName("");
      setUnit("NOS");
      setGstRate("18");
      setHsn("");
    }
  }, [open, editId]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        name: name.trim(),
        unit,
        gst_rate: parseFloat(gstRate) || 0,
        hsn_code: hsn.trim() || null,
      };
      if (editId) {
        const { data, error } = await supabase
          .from("items")
          .update(payload)
          .eq("id", editId)
          .select("id, name, unit, gst_rate, hsn_code")
          .single();
        if (error) throw error;
        toast.success("Item updated");
        onSaved(data as QuickItem);
      } else {
        const { data, error } = await supabase
          .from("items")
          .insert(payload)
          .select("id, name, unit, gst_rate, hsn_code")
          .single();
        if (error) throw error;
        toast.success("Item created");
        onSaved(data as QuickItem);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const enterTab = useEnterAsTab(() => {
    if (!saving) submit();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (!saving) submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editId ? "Edit Item" : "Quick Create Item"}</DialogTitle>
        </DialogHeader>
        <div ref={enterTab.ref} onKeyDown={enterTab.onKeyDown} className="grid gap-3">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>GST %</Label>
              <Select value={gstRate} onValueChange={setGstRate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>HSN/SAC</Label>
              <Input value={hsn} onChange={(e) => setHsn(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
