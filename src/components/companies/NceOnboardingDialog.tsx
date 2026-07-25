import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { classifyNceLevel, NCE_LEVEL_LABEL } from "@/lib/nce-classification";
import type { EntityStatus } from "@/lib/entity-status";
import { supabase } from "@/integrations/supabase/client";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  entity: EntityStatus;
  initialTurnoverLakhs?: string;
  initialBorrowingsLakhs?: string;
  onSaved?: () => void;
}

/**
 * Lightweight NCE onboarding wizard shown right after company creation.
 * Captures turnover + borrowings and auto-derives the ICAI Level so the
 * user doesn't have to open the full settings form to unlock the correct
 * disclosure shape (cash flow, related-party, etc.).
 */
export function NceOnboardingDialog({
  open, onOpenChange, companyId, entity,
  initialTurnoverLakhs = "", initialBorrowingsLakhs = "",
  onSaved,
}: Props) {
  const [turnover, setTurnover] = useState(initialTurnoverLakhs);
  const [borrow, setBorrow] = useState(initialBorrowingsLakhs);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTurnover(initialTurnoverLakhs);
      setBorrow(initialBorrowingsLakhs);
    }
  }, [open, initialTurnoverLakhs, initialBorrowingsLakhs]);

  const auto = useMemo(() => {
    const tPaise = Math.round((parseFloat(turnover) || 0) * 100000 * 100);
    const bPaise = Math.round((parseFloat(borrow) || 0) * 100000 * 100);
    return classifyNceLevel({ entity, turnoverPaise: tPaise, borrowingsPaise: bPaise });
  }, [turnover, borrow, entity]);

  const save = async () => {
    setSaving(true);
    const patch = {
      annual_turnover_paise: Math.round((parseFloat(turnover) || 0) * 100000 * 100),
      borrowings_paise: Math.round((parseFloat(borrow) || 0) * 100000 * 100),
      updated_at: new Date().toISOString(),
    };
    try {
      // Cloud best-effort — non-blocking for local-only mode.
      const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
      if (error && !isLocalOnlyMode()) throw error;
    } catch (e: any) {
      // In local-only or offline mode we swallow; local cache is authoritative.
      if (!isLocalOnlyMode()) {
        toast.error(e?.message ?? "Cloud update failed — saved locally");
      }
    }
    try {
      const { offlineDb } = await import("@/lib/offline/db");
      const existing = (await offlineDb.cache_companies.get(companyId)) || { id: companyId };
      await offlineDb.cache_companies.put({ ...existing, ...patch, id: companyId });
    } catch { /* non-fatal */ }
    // Mark this company as "onboarded" so we don't re-prompt on every open.
    try { localStorage.setItem(`ym_nce_onboarded_${companyId}`, "1"); } catch { /* ignore */ }
    setSaving(false);
    toast.success(`Saved — ${NCE_LEVEL_LABEL[auto.level]}`);
    onSaved?.();
    onOpenChange(false);
  };

  const skip = () => {
    try { localStorage.setItem(`ym_nce_onboarded_${companyId}`, "1"); } catch { /* ignore */ }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set NCE compliance level</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter last year's turnover and outstanding borrowings. We pick the correct
            ICAI Non-Corporate Entity level automatically so your reports show only the
            disclosures you actually need.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="onb_turnover">Turnover (₹ Lakhs)</Label>
              <Input
                id="onb_turnover" inputMode="decimal" autoFocus
                value={turnover} onChange={(e) => setTurnover(e.target.value)}
                placeholder="e.g. 120"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="onb_borrow">Borrowings (₹ Lakhs)</Label>
              <Input
                id="onb_borrow" inputMode="decimal"
                value={borrow} onChange={(e) => setBorrow(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Suggested:</span>
              <Badge variant={auto.isCorporate ? "default" : "secondary"}>
                {auto.isCorporate ? "Schedule III (Companies Act)" : NCE_LEVEL_LABEL[auto.level]}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{auto.reason}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Thresholds — L1: turnover &gt; ₹250 Cr or borrowings &gt; ₹50 Cr · L2: &gt; ₹50 Cr / &gt; ₹10 Cr.
            You can override this any time from Company settings.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={skip} disabled={saving}>Skip for now</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
