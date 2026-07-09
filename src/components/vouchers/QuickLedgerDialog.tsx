import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_TYPES, INDIAN_STATES } from "@/lib/constants";
import { GstinPortalWindow } from "@/components/GstinPortalWindow";
import { GstinInlineError } from "@/components/GstinInlineError";
import { createLedger, updateLedger } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { offlineDb } from "@/lib/offline/db";
import { lookupGstinViaSetu } from "@/lib/setu";
import { validateGSTIN } from "@/utils/gstinValidator";

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
  const [verifying, setVerifying] = useState(false);
  const verifiedForRef = useRef<string>("");

  // 1. Hook to track editing states and pull master rows down dynamically from local storage
  useEffect(() => {
    if (!open) return;
    if (editId) {
      if (isLocalOnlyMode()) {
        offlineDb.cache_ledgers.get(editId).then((data) => {
          if (data) {
            setName(data.name ?? "");
            setType(data.type ?? "sundry_debtor");
            setGstin(data.gstin || "");
            setStateCode(data.state_code || "");
            setAddress(data.address || "");
          }
        });
        return;
      }
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

  // 2. AWESOME AUTO-POPULATE TRANSITION: Watches keystrokes and matches State dropdown instantly
  useEffect(() => {
    const cleanGstin = gstin.trim();
    if (cleanGstin.length >= 2) {
      const prefix = cleanGstin.substring(0, 2);
      const matchedState = INDIAN_STATES.find((s) => s.code === prefix);
      if (matchedState) {
        setStateCode(matchedState.code);
      }
    }
  }, [gstin]);

  // 3. Auto-verify via API Setu once a valid 15-char GSTIN is entered.
  //    Fills legal name (if user hasn't already typed one) and address.
  useEffect(() => {
    const cleanGstin = gstin.trim().toUpperCase();
    if (cleanGstin.length !== 15) return;
    if (!validateGSTIN(cleanGstin).valid) return;
    if (verifiedForRef.current === cleanGstin) return;
    let cancelled = false;
    verifiedForRef.current = cleanGstin;
    setVerifying(true);
    lookupGstinViaSetu(cleanGstin)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          if (res.error) toast.error(`GSTIN verify: ${res.error}`);
          return;
        }
        setName((prev) => (prev.trim() ? prev : (res.legalName || res.tradeName || prev)));
        if (res.principalPlaceOfBusiness) {
          setAddress((prev) => (prev.trim() ? prev : res.principalPlaceOfBusiness ?? prev));
        }
        toast.success(`Verified: ${res.legalName || res.tradeName}`);
      })
      .catch((e) => { if (!cancelled) toast.error(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setVerifying(false); });
    return () => { cancelled = true; };
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
        toast.success(isLocalOnlyMode() || isOnlineNow() ? "Ledger updated on this device" : "Ledger saved on this device");
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
        toast.success(isLocalOnlyMode() || isOnlineNow() ? "Ledger created on this device" : "Ledger saved on this device");
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
        className="max-w-xl w-full bg-white border border-slate-200 shadow-2xl rounded-xl"
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
          <DialogTitle className="text-slate-800 font-bold tracking-tight">
            {editId ? "Edit Ledger" : "Quick Create Ledger"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-2">
          {/* Name Input */}
          <div className="space-y-1">
            <Label className="text-slate-600 text-xs font-semibold">Name *</Label>
            <Input 
              autoFocus 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              className="border-slate-200 focus-visible:ring-indigo-500"
            />
          </div>
          
          {/* Type Input */}
          <div className="space-y-1">
            <Label className="text-slate-600 text-xs font-semibold">Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="border-slate-200 focus:ring-indigo-500"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEDGER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* BEAUTIFUL & UN-SQUISHED GSTIN/STATE SECTION CONTAINER */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
            
            {/* Left Box: GSTIN Code Field + Awesome Sidebar Neighborhood Popover */}
            <div className="space-y-1 w-full flex flex-col">
              <Label className="text-slate-600 text-xs font-semibold">GSTIN</Label>
              <div className="flex items-center gap-2 w-full">
                <Input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase().trim())}
                  maxLength={15}
                  placeholder="24AAAAA0000A1Z5"
                  className="flex-1 font-mono uppercase tracking-wider h-9 border-slate-200 focus-visible:ring-indigo-500"
                />
                <GstinPortalWindow 
                  gstin={gstin} 
                  onDataFetched={(parsedParty) => {
                    if (parsedParty?.gstin) {
                      setGstin(parsedParty.gstin.toUpperCase().trim());
                      setName(parsedParty.legalName);
                      toast.success(`Successfully Synced: ${parsedParty.legalName}`, {
                        className: "bg-emerald-50 border-emerald-200 text-emerald-800 font-medium"
                      });
                    }
                  }}
                />
              </div>
              <GstinInlineError value={gstin} />
            </div>
            
            {/* Right Box: State Picker Dropdown Selector */}
            <div className="space-y-1 w-full">
              <Label className="text-slate-600 text-xs font-semibold">State</Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger className="w-full h-9 border-slate-200 focus:ring-indigo-500">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>
          
          {/* Address Input */}
          <div className="space-y-1">
            <Label className="text-slate-600 text-xs font-semibold">Address</Label>
            <Input 
              value={address} 
              onChange={(e) => setAddress(e.target.value)} 
              className="border-slate-200 focus-visible:ring-indigo-500"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-500 hover:bg-slate-50">
            Cancel
          </Button>
          <Button 
            onClick={submit} 
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm"
          >
            {saving ? "Saving…" : "Save Ledger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
