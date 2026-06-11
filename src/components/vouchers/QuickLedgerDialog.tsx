import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_TYPES, INDIAN_STATES } from "@/lib/constants";
import { GstinPortalButton } from "@/components/GstinPortalButton";
import { GstinInlineError } from "@/components/GstinInlineError";
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

  // 1. Hook to track editing states and reset forms cleanly on open toggles
  useEffect(() => {
    if (!open) return;
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

  // 2. AUTO-POPULATE STATE DROPDOWN INSTANTLY FROM GSTIN PREFIX
  useEffect(() => {
    const cleanGstin = gstin.trim();
    if (cleanGstin.length >= 2) {
      const prefix = cleanGstin.substring(0, 2);
      // Validate if the extracted 2 digits match a valid entry inside INDIAN_STATES constant list
      const matchedState = INDIAN_STATES.find((s) => s.code === prefix);
      if (matchedState) {
        setStateCode(matchedState.code);
      }
    }
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
        className="max-w-xl w-full"
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
        <div className="grid gap-4 py-2">
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
          
          {/* RECONCILED GRID: Restructuring space parameters to prevent squishing layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
            
            {/* Left Column Section: GSTIN Field Wrapper */}
            <div className="space-y-1 w-full flex flex-col">
              <Label>GSTIN</Label>
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase().trim())}
                maxLength={15}
                placeholder="22AAAAA0000A1Z5"
                className="w-full font-mono uppercase"
              />
              {/* Stack the verification button at 100% block width safely right below the input field */}
              <div className="w-full mt-1.5">
                <GstinPortalButton 
                  gstin={gstin} 
                  onDataFetched={(parsedParty) => {
                    if (parsedParty?.gstin) {
                      setGstin(parsedParty.gstin.toUpperCase().trim());
                    }
                  }}
                />
              </div>
              <GstinInlineError value={gstin} />
            </div>
            
            {/* Right Column Section: State Dropdown Selector Wrapper */}
            <div className="space-y-1 w-full">
              <Label>State</Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger className="w-full h-10"><SelectValue placeholder="—" /></SelectTrigger>
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
