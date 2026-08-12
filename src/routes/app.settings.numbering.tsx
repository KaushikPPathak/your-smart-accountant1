import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Hash, Info, ListChecks } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/lib/company-context";
import { useVoucherPrefs } from "@/hooks/useVoucherPrefs";
import { SALES_STAGES, ruleFor, type SalesStageKey, type VoucherPrefs } from "@/lib/voucher-prefs";
import {
  DEFAULT_RULE, NUMBERING_PRESETS, sampleNumber, type NumberingRule, type ResetPeriod,
} from "@/lib/voucher-numbering";
import { voucherTypeLabel } from "@/lib/voucher-type-label";

export const Route = createFileRoute("/app/settings/numbering")({
  head: () => ({ meta: [{ title: "Voucher numbering — Settings" }] }),
  component: NumberingSettingsPage,
});

const NUMBERED_TYPES = [
  "sales", "purchase", "receipt", "payment", "journal", "contra",
  "credit_note", "debit_note", "quotation", "sales_order", "delivery_note",
];

function NumberingSettingsPage() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const { prefs, save } = useVoucherPrefs(activeCompanyId);
  const [openType, setOpenType] = useState<string>("sales");
  const [saving, setSaving] = useState(false);

  const rule = useMemo(() => ruleFor(prefs, openType), [prefs, openType]);

  const patch = async (next: Partial<VoucherPrefs>) => {
    if (!activeCompanyId) { toast.error("Select a company first"); return; }
    setSaving(true);
    try {
      await save({ ...prefs, ...next });
    } finally { setSaving(false); }
  };

  const setRule = (partial: Partial<NumberingRule>) =>
    patch({ rules: { ...prefs.rules, [openType]: { ...rule, ...partial } } });

  const toggleStage = (key: SalesStageKey, on: boolean) =>
    patch({ stages: { ...prefs.stages, [key]: on } });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/settings" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back
        </Button>
        <h1 className="text-xl font-semibold">Voucher numbering &amp; sales cycle</h1>
      </div>

      {/* ---- Sales cycle stages ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />Sales cycle stages
          </CardTitle>
          <CardDescription>
            Tick only the documents your business raises. Sales Invoice is always available;
            everything unticked stays out of the menus and shortcuts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SALES_STAGES.map((s) => (
            <label
              key={s.key}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40"
            >
              <Checkbox
                checked={!!prefs.stages[s.key]}
                onCheckedChange={(v) => void toggleStage(s.key, v === true)}
                aria-label={s.label}
              />
              <span>
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.desc}</span>
              </span>
            </label>
          ))}
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Typical flow when all three are on: Quotation → Sales Order → Delivery Challan →
            Sales Invoice. Any already-saved documents stay intact even if you untick a stage.
          </div>
        </CardContent>
      </Card>

      {/* ---- Numbering ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hash className="h-4 w-4" />Numbering format
          </CardTitle>
          <CardDescription>
            Set a separate format per voucher type. Numbers are allocated at save time and
            never reuse a number already on record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2 sm:max-w-xs">
            <Label>Voucher type</Label>
            <Select value={openType} onValueChange={setOpenType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBERED_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{voucherTypeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quick presets</Label>
            <div className="flex flex-wrap gap-2">
              {NUMBERING_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void setRule({ ...p.rule })}
                  title={p.hint}
                >
                  {p.label}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{p.hint.split(",")[0]}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="np">Prefix</Label>
              <Input id="np" value={rule.prefix} placeholder="INV"
                onChange={(e) => void setRule({ prefix: e.target.value.toUpperCase() })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns">Suffix</Label>
              <Input id="ns" value={rule.suffix} placeholder="(optional)"
                onChange={(e) => void setRule({ suffix: e.target.value.toUpperCase() })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nsep">Separator</Label>
              <Select value={rule.separator || "none"}
                onValueChange={(v) => void setRule({ separator: v === "none" ? "" : v })}>
                <SelectTrigger id="nsep"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="/">Slash /</SelectItem>
                  <SelectItem value="-">Hyphen -</SelectItem>
                  <SelectItem value=".">Dot .</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nw">Digits (zero padding)</Label>
              <Input id="nw" type="number" min={1} max={8} value={rule.width}
                onChange={(e) => void setRule({ width: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nstart">Start from</Label>
              <Input id="nstart" type="number" min={1} value={rule.start}
                onChange={(e) => void setRule({ start: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nreset">Restart numbering</Label>
              <Select value={rule.reset}
                onValueChange={(v) => void setRule({ reset: v as ResetPeriod })}>
                <SelectTrigger id="nreset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never (continuous)</SelectItem>
                  <SelectItem value="yearly">Every financial year</SelectItem>
                  <SelectItem value="monthly">Every month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">Include financial year (25-26)</span>
              <Switch checked={rule.includeFy}
                onCheckedChange={(v) => void setRule({ includeFy: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">Include month (04)</span>
              <Switch checked={rule.includeMonth}
                onCheckedChange={(v) => void setRule({ includeMonth: v })} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <span className="text-sm text-muted-foreground">Preview:</span>
            <span className="font-mono text-base font-semibold text-primary">
              {sampleNumber(rule)}
            </span>
            <span className="text-xs text-muted-foreground">
              then {sampleNumber({ ...rule, start: rule.start + 1 })}
            </span>
            <Button className="ml-auto" variant="ghost" size="sm" disabled={saving}
              onClick={() => void setRule({ ...DEFAULT_RULE })}>
              Reset to plain serial
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
