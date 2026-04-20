import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_TYPES, INDIAN_STATES, GSTIN_REGEX } from "@/lib/constants";
import { lookupGstin } from "@/lib/gstin-lookup.functions";

export interface QuickLedger {
  id: string;
  name: string;
  type: string;
  state_code: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  /** When set, edit this ledger instead of creating */
  editId?: string | null;
  onSaved: (ledger: QuickLedger) => void;
}

export function QuickLedgerDialog({ open, onOpenChange, companyId, editId, onSaved }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("sundry_debtor");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editId) {
      supabase
        .from("ledgers")
        .select("name, type, gstin, state_code")
        .eq("id", editId)
        .single()
        .then(({ data }) => {
          if (data) {
            setName(data.name);
            setType(data.type);
            setGstin(data.gstin || "");
            setStateCode(data.state_code || "");
          }
        });
    } else {
      setName("");
      setType("sundry_debtor");
      setGstin("");
      setStateCode("");
    }
  }, [open, editId]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    setSaving(true);
    try {
      const state = INDIAN_STATES.find((s) => s.code === stateCode);
      const payload = {
        company_id: companyId,
        name: name.trim(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: type as any,
        gstin: gstin.trim() || null,
        state_code: stateCode || null,
        state: state?.name ?? null,
      };
      if (editId) {
        const { data, error } = await supabase
          .from("ledgers")
          .update(payload)
          .eq("id", editId)
          .select("id, name, type, state_code")
          .single();
        if (error) throw error;
        toast.success("Ledger updated");
        onSaved(data as QuickLedger);
      } else {
        const { data, error } = await supabase
          .from("ledgers")
          .insert(payload)
          .select("id, name, type, state_code")
          .single();
        if (error) throw error;
        toast.success("Ledger created");
        onSaved(data as QuickLedger);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

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
          <DialogTitle>{editId ? "Edit Ledger" : "Quick Create Ledger"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEDGER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
