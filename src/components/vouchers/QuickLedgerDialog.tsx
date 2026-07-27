import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_TYPES, INDIAN_STATES, type LedgerTypeValue } from "@/lib/constants";
import { GST_REGISTRATION_TYPES, MSME_CLASSIFICATIONS } from "@/lib/schemas/ledger";
import { GstinPortalWindow } from "@/components/GstinPortalWindow";
import { GstinInlineError } from "@/components/GstinInlineError";
import { createLedger, updateLedger } from "@/lib/offline/masters";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { offlineDb } from "@/lib/offline/db";
import { lookupGstinViaSetu } from "@/lib/setu";
import { validateGSTIN } from "@/utils/gstinValidator";
import { toTitleCaseOnType } from "@/lib/text-case";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";
import {
  ACCOUNT_GROUPS,
  GROUP_BY_CODE,
  defaultGroupCodeForType,
  groupLabel as builtinGroupLabel,
} from "@/lib/account-groups";
import { useAccountGroups, resolveGroupLabel, subgroupsFor } from "@/lib/account-groups-runtime";

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
  editId?: string | null;
  onSaved: (ledger: QuickLedger) => void;
}

// Party ledgers = external legal entities where GSTIN / PAN / credit terms / MSME apply.
const PARTY_TYPES = new Set(["sundry_debtor", "sundry_creditor"]);
// Bank/cash ledgers have their own minimal profile (branch/phone) — no GSTIN.
const BANKISH_TYPES = new Set(["bank"]);
// Everything else (income, expense, capital, duties, stock, etc.) is an internal
// nominal/real account — accounting standards do not attach GSTIN, PAN, MSME,
// or credit-terms to these; only Name + Type is meaningful.

type Profile = "party" | "bank" | "internal";

function profileFor(type: string): Profile {
  if (PARTY_TYPES.has(type)) return "party";
  if (BANKISH_TYPES.has(type)) return "bank";
  return "internal";
}

export function QuickLedgerDialog({ open, onOpenChange, companyId, editId, onSaved }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("sundry_debtor");
  const [gstin, setGstin] = useState("");
  const [gstRegType, setGstRegType] = useState<string>("regular");
  const [pan, setPan] = useState("");
  const [stateCode, setStateCode] = useState<string>("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creditLimit, setCreditLimit] = useState<string>("");
  const [creditDays, setCreditDays] = useState<string>("");
  const [msme, setMsme] = useState(false);
  const [msmeNo, setMsmeNo] = useState("");
  const [msmeClass, setMsmeClass] = useState<string>("micro");
  const [groupCode, setGroupCode] = useState<string>("");
  const [subgroupId, setSubgroupId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifiedForRef = useRef<string>("");

  const profile = useMemo(() => profileFor(type), [type]);
  const { subgroups, overrides } = useAccountGroups();
  // Groups whose ledgerTypes include the current selected type — offered first.
  const compatibleGroups = useMemo(
    () => ACCOUNT_GROUPS.filter((g) => g.ledgerTypes.includes(type as LedgerTypeValue)),
    [type],
  );

  useEffect(() => {
    if (!open) return;
    if (editId) {
      const apply = (data: Record<string, unknown> | null | undefined) => {
        if (!data) return;
        setName((data.name as string) ?? "");
        setType((data.type as string) ?? "sundry_debtor");
        setGstin((data.gstin as string) || "");
        setGstRegType((data.gst_treatment as string) || (data.gst_registration_type as string) || "regular");
        setPan((data.pan as string) || "");
        setStateCode((data.state_code as string) || "");
        setAddress((data.address as string) || "");
        setPhone((data.phone as string) || "");
        setEmail((data.email as string) || "");
        setCreditLimit(
          data.credit_limit_paise ? String(paiseToRupees(Number(data.credit_limit_paise))) : "",
        );
        setCreditDays(data.credit_days != null ? String(data.credit_days) : "");
        setMsme(Boolean(data.msme_registered));
        setMsmeNo((data.msme_udyam_no as string) || "");
        setMsmeClass((data.msme_classification as string) || "micro");
      };
      if (isLocalOnlyMode()) {
        offlineDb.cache_ledgers.get(editId).then((d) => apply(d as Record<string, unknown>));
        return;
      }
      supabase
        .from("ledgers")
        .select("name, type, gstin, pan, state_code, address, phone, email, credit_limit_paise, credit_days, gst_treatment")
        .eq("id", editId)
        .single()
        .then(({ data }) => apply(data as Record<string, unknown>));
    } else {
      setName(""); setType("sundry_debtor"); setGstin(""); setGstRegType("regular");
      setPan(""); setStateCode(""); setAddress(""); setPhone(""); setEmail("");
      setCreditLimit(""); setCreditDays(""); setMsme(false); setMsmeNo(""); setMsmeClass("micro");
    }
  }, [open, editId]);

  // GSTIN → auto-fill state
  useEffect(() => {
    if (profile !== "party") return;
    const clean = gstin.trim();
    if (clean.length >= 2) {
      const m = INDIAN_STATES.find((s) => s.code === clean.substring(0, 2));
      if (m) setStateCode(m.code);
    }
  }, [gstin, profile]);

  // GSTIN → verify via Setu (party only)
  useEffect(() => {
    if (profile !== "party") return;
    const clean = gstin.trim().toUpperCase();
    if (clean.length !== 15) return;
    if (!validateGSTIN(clean).valid) return;
    if (verifiedForRef.current === clean) return;
    let cancelled = false;
    verifiedForRef.current = clean;
    setVerifying(true);
    lookupGstinViaSetu(clean)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          if (res.error) toast.error(`GSTIN verify: ${res.error}`);
          return;
        }
        setName((prev) => (prev.trim() ? prev : toTitleCaseOnType(res.legalName || res.tradeName || prev)));
        if (res.principalPlaceOfBusiness) {
          setAddress((prev) => (prev.trim() ? prev : res.principalPlaceOfBusiness ?? prev));
        }
        toast.success(`Verified: ${res.legalName || res.tradeName}`);
      })
      .catch((e) => { if (!cancelled) toast.error(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setVerifying(false); });
    return () => { cancelled = true; };
  }, [gstin, profile]);

  const submit = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const state = INDIAN_STATES.find((s) => s.code === stateCode);
      const isParty = profile === "party";
      const isBank = profile === "bank";
      const payload = {
        company_id: companyId,
        name: name.trim(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: type as any,
        gstin: isParty ? (gstin.trim() || null) : null,
        pan: isParty ? (pan.trim().toUpperCase() || null) : null,
        state_code: isParty ? (stateCode || null) : null,
        state: isParty ? (state?.name ?? null) : null,
        address: (isParty || isBank) ? (address.trim() || null) : null,
        phone: (isParty || isBank) ? (phone.trim() || null) : null,
        email: isParty ? (email.trim() || null) : null,
        credit_limit_paise: isParty && creditLimit ? rupeesToPaise(Number(creditLimit) || 0) : 0,
        credit_days: isParty && creditDays ? Number(creditDays) || 0 : 0,
        gst_registration_type: isParty ? gstRegType : null,
        msme_registered: isParty ? msme : false,
        msme_udyam_no: isParty && msme ? (msmeNo.trim() || null) : null,
        msme_classification: isParty && msme ? msmeClass : null,
      };

      if (editId) {
        const row = await updateLedger(editId, companyId, payload);
        toast.success(isLocalOnlyMode() || isOnlineNow() ? "Ledger updated on this device" : "Ledger saved on this device");
        onSaved(row ?? {
          id: editId, name: payload.name, type: String(payload.type),
          state_code: payload.state_code, gstin: payload.gstin, gst_treatment: gstRegType,
        });
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
        className="max-w-xl w-full bg-white border border-slate-200 shadow-2xl rounded-xl max-h-[90vh] overflow-y-auto"
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
          {/* Name */}
          <div className="space-y-1">
            <Label className="text-slate-600 text-xs font-semibold">Name *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(toTitleCaseOnType(e.target.value))}
              className="border-slate-200 focus-visible:ring-indigo-500"
            />
          </div>

          {/* Type */}
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
            {profile === "internal" && (
              <p className="text-[11px] text-slate-500 pt-1">
                Nominal / real account — no GSTIN, PAN, credit terms or MSME details apply
                (per standard accounting classification).
              </p>
            )}
          </div>

          {/* PARTY-ONLY block: GSTIN, GST reg type, PAN, State, Address, Contact, Credit terms, MSME */}
          {profile === "party" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
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
                    {verifying && <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />}
                    <GstinPortalWindow
                      gstin={gstin}
                      onDataFetched={(p) => {
                        if (p?.gstin) {
                          setGstin(p.gstin.toUpperCase().trim());
                          setName(toTitleCaseOnType(p.legalName));
                          toast.success(`Successfully Synced: ${p.legalName}`);
                        }
                      }}
                    />
                  </div>
                  <GstinInlineError value={gstin} />
                </div>

                <div className="space-y-1 w-full">
                  <Label className="text-slate-600 text-xs font-semibold">GST Registration Type</Label>
                  <Select value={gstRegType} onValueChange={setGstRegType}>
                    <SelectTrigger className="w-full h-9 border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GST_REGISTRATION_TYPES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
                <div className="space-y-1 w-full">
                  <Label className="text-slate-600 text-xs font-semibold">PAN</Label>
                  <Input
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase().trim())}
                    maxLength={10}
                    placeholder="AAAAA0000A"
                    className="font-mono uppercase tracking-wider h-9 border-slate-200"
                  />
                </div>
                <div className="space-y-1 w-full">
                  <Label className="text-slate-600 text-xs font-semibold">State</Label>
                  <Select value={stateCode} onValueChange={setStateCode}>
                    <SelectTrigger className="w-full h-9 border-slate-200"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-slate-600 text-xs font-semibold">Address</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} className="border-slate-200" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-slate-600 text-xs font-semibold">Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="border-slate-200" />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-600 text-xs font-semibold">Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} className="border-slate-200" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-slate-600 text-xs font-semibold">Credit Limit (₹)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    className="border-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-600 text-xs font-semibold">Credit Days</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={creditDays}
                    onChange={(e) => setCreditDays(e.target.value)}
                    className="border-slate-200"
                  />
                </div>
              </div>

              <div className="rounded-md border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-700 text-xs font-semibold">MSME Registered</Label>
                  <Switch checked={msme} onCheckedChange={setMsme} />
                </div>
                {msme && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-slate-600 text-[11px] font-semibold">Udyam No.</Label>
                      <Input value={msmeNo} onChange={(e) => setMsmeNo(e.target.value.toUpperCase())} className="h-9 border-slate-200 font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-slate-600 text-[11px] font-semibold">Classification</Label>
                      <Select value={msmeClass} onValueChange={setMsmeClass}>
                        <SelectTrigger className="h-9 border-slate-200"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MSME_CLASSIFICATIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* BANK block: branch address + phone (no GSTIN/PAN/credit) */}
          {profile === "bank" && (
            <>
              <div className="space-y-1">
                <Label className="text-slate-600 text-xs font-semibold">Branch / Address</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} className="border-slate-200" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-600 text-xs font-semibold">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="border-slate-200" />
              </div>
            </>
          )}
        </div>

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
