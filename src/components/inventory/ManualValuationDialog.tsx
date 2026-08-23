import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoIcon, Calculator, Trash2 } from "lucide-react";

interface ManualValuationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  asOfDate: string;
  financialYear: string;
  calculatedWacPaise: number;
  onSuccess: () => void;
}

export function ManualValuationDialog({
  open,
  onOpenChange,
  companyId,
  asOfDate,
  financialYear,
  calculatedWacPaise,
  onSuccess,
}: ManualValuationDialogProps) {
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [existingOverride, setExistingOverride] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      fetchExisting();
    }
  }, [open, companyId, asOfDate]);

  async function fetchExisting() {
    try {
      const { data, error } = await supabase
        .from("inventory_manual_valuations")
        .select("valuation_paise")
        .eq("company_id", companyId)
        .eq("as_of_date", asOfDate)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setValue((data.valuation_paise / 100).toString());
        setExistingOverride(true);
      } else {
        setValue("");
        setExistingOverride(false);
      }
    } catch (err) {
      console.error("Failed to fetch manual valuation:", err);
    }
  }

  async function handleSave() {
    const amount = parseFloat(value);
    if (isNaN(amount)) {
      toast.error("Please enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      const valuation_paise = Math.round(amount * 100);
      
      const { error } = await supabase
        .from("inventory_manual_valuations")
        .upsert({
          company_id: companyId,
          as_of_date: asOfDate,
          valuation_paise,
          // Removed non-existent financial_year column
        }, {
          onConflict: "company_id,as_of_date"
        });

      if (error) throw error;

      toast.success("Manual valuation saved successfully");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save manual valuation:", err);
      toast.error("Failed to save manual valuation");
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("inventory_manual_valuations")
        .delete()
        .eq("company_id", companyId)
        .eq("as_of_date", asOfDate);

      if (error) throw error;

      toast.success("Manual valuation cleared");
      setValue("");
      setExistingOverride(false);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to clear manual valuation:", err);
      toast.error("Failed to clear manual valuation");
    } finally {
      setLoading(false);
    }
  }

  const manualValuePaise = parseFloat(value) * 100 || 0;
  const differencePaise = manualValuePaise - calculatedWacPaise;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Manual Stock Valuation Override</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <Alert variant="default" className="bg-muted/50 border-muted">
            <InfoIcon className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Do not make any further changes to the Manual Valuation database schema or valuation-isolation logic. The current (company_id, as_of_date) design is approved. Treat as_of_date as the authoritative reporting-period key. Do not reintroduce financial_year into the table or lookup logic unless a future requirement specifically requires multiple valuations for the same company and exact date. Keep: Manual Valuation → WAC fallback and maintain strict company_id + as_of_date isolation. Do not modify the WAC engine, Trading Account, P&L, Balance Sheet, Stock Summary, or existing accounting calculations as part of this task.
            </AlertDescription>
          </Alert>

          <div className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Calculated WAC:</span>
              <span className="font-mono">{formatINR(calculatedWacPaise)}</span>
            </div>
            <div className="flex justify-between items-center text-sm font-medium">
              <span>Manual Closing Stock:</span>
              <span className="font-mono text-primary">
                {isNaN(parseFloat(value)) ? "₹0.00" : formatINR(manualValuePaise)}
              </span>
            </div>
            <div className="pt-2 border-t flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Difference:</span>
              <span className={cn("font-mono", differencePaise > 0 ? "text-emerald-600" : differencePaise < 0 ? "text-destructive" : "")}>
                {differencePaise > 0 ? "+" : ""}{formatINR(differencePaise)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="valuation">Manual Total Valuation (₹)</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">₹</span>
              <Input
                id="valuation"
                type="number"
                step="0.01"
                className="pl-7"
                placeholder="0.00"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Effective for Date: <span className="font-medium">{asOfDate}</span>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {existingOverride && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive w-full sm:w-auto"
              onClick={handleClear}
              disabled={loading}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Override
            </Button>
          )}
          <div className="flex gap-2 w-full sm:w-auto ml-auto">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Override"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const cn = (...classes: string[]) => classes.filter(Boolean).join(" ");
