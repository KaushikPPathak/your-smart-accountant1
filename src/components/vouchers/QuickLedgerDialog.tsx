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
import { createLedger, updateLedger } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";

export interface QuickLedger {
  id: string;
  name: string;
  type: string;
  state_code: string | null;
  gstin: string | null;
  gst_treatment: string | null;
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
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const lookedRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    lookedRef.current = "";
    if (editId) {
      supabase
        .from("ledgers")
        .select("name, type, gstin, state_code, address")
        .eq("id", editId)
        .single()
        .then(({ data }) => {
          if (data) {
            setName(data.name);
            setType(data.type);
            setGstin(data.gstin || "");
            setStateCode(data.state_code || "");
            setAddress(data.address || "");
            lookedRef.current = data.gstin || "";
          }
        });
    } else {
      setName("");
      setType("sundry_debtor");
      setGstin("");
      setStateCode("");
      setAddress("");
    }
  }, [open, editId]);

  useEffect(() => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15 || !GSTIN_REGEX.test(g) || g === lookedRef.current) return;
    lookedRef.current = g;
    setLooking(true);
    lookupGstin({ data: { gstin: g } })
      .then((res) => {
        if (!res.ok || !res.data) {
          toast.error(res.error || "GSTIN lookup failed");
          return;
        }
        const d = res.data;
        if (!name.trim()) setName(d.tradeName || d.legalName);
        if (!address.trim()) setAddress(d.address);
        if (!stateCode && d.stateCode) setStateCode(d.stateCode);
        toast.success("GSTIN details fetched");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Lookup failed"))
      .finally(() => setLooking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin]);

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
        address: address.trim() || null,
      };
      if (editId) {
        const row = await updateLedger(editId, companyId, payload);
        toast.success(isOnlineNow() ? "Ledger updated" : "Ledger update queued — will sync when online");
        onSaved(
          row ?? {
            id: editId,
            name: payload.name,
            type: String(payload.type),
            state_code: payload.state_code,
            gstin: payload.gstin,
            gst_treatment: "regular",
          },
        );
      } else {
        const row = await createLedger(payload);
        toast.success(isOnlineNow() ? "Ledger created" : "Ledger queued — will sync when online");
        onSaved(row);
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
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
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
              <Label className="flex items-center gap-2">
                GSTIN {looking && <Loader2 className="h-3 w-3 animate-spin" />}
              </Label>
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                maxLength={15}
                placeholder="22AAAAA0000A1Z5"
              />
              <p className="text-[10px] text-muted-foreground">Auto-fetches name & address</p>
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
          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
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
