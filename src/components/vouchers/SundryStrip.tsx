import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINR, rupeesToPaise } from "@/lib/money";
import {
  SUNDRY_TYPE_LABELS,
  SUNDRY_STAGE_LABELS,
  defaultSignForType,
  defaultStageForType,
  type Sundry,
  type SundryMode,
  type SundryStage,
  type SundryType,
} from "@/lib/sundries";

interface LedgerLite {
  id: string;
  name: string;
  type: string;
}

interface Props {
  sundries: Sundry[];
  onChange: (next: Sundry[]) => void;
  ledgerOptions: LedgerLite[];
  onCreateLedger?: () => void;
  disabled?: boolean;
}

/**
 * SundryStrip — the "+ Add charge" surface for the totals block.
 *
 * Each charge can be entered as a flat ₹ amount OR as a % of the base, and
 * applied BEFORE GST (folded into taxable value) or AFTER GST (added to
 * grand total, no tax effect). The signed convention lives in
 * `src/lib/sundries.ts`.
 */
export function SundryStrip({ sundries, onChange, ledgerOptions, onCreateLedger, disabled }: Props) {
  return (
    <div className="space-y-1">
      {sundries.length > 0 && (
        <div className="space-y-1">
          {sundries.map((s) => {
            const lg = ledgerOptions.find((l) => l.id === s.ledger_id);
            const stage = s.apply_stage ?? "post_gst";
            const isPercent = (s.mode ?? "amount") === "percent";
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex-1 min-w-0 truncate text-muted-foreground">
                  <span className="font-medium text-foreground">{SUNDRY_TYPE_LABELS[s.sundry_type]}</span>
                  {isPercent && (
                    <span> · {((s.rate_bps ?? 0) / 100).toFixed(2)}%</span>
                  )}
                  <span> · <span className={stage === "pre_gst" ? "text-primary" : ""}>{SUNDRY_STAGE_LABELS[stage]}</span></span>
                  {lg ? <span> · {lg.name}</span> : <span className="text-destructive"> · ledger missing</span>}
                </div>
                <span className={`font-mono ${s.amount_paise < 0 ? "text-destructive" : ""}`}>
                  {s.amount_paise < 0 ? "−" : ""}{formatINR(Math.abs(s.amount_paise))}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={disabled}
                  onClick={() => onChange(sundries.filter((x) => x.id !== s.id))}
                  aria-label="Remove charge"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <AddChargePopover
        ledgerOptions={ledgerOptions}
        onCreateLedger={onCreateLedger}
        disabled={disabled}
        onAdd={(s) => onChange([...sundries, s])}
      />
    </div>
  );
}

function AddChargePopover({
  ledgerOptions,
  onCreateLedger,
  disabled,
  onAdd,
}: {
  ledgerOptions: LedgerLite[];
  onCreateLedger?: () => void;
  disabled?: boolean;
  onAdd: (s: Sundry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SundryType>("freight");
  const [ledgerId, setLedgerId] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [mode, setMode] = useState<SundryMode>("amount");
  const [stage, setStage] = useState<SundryStage>("post_gst");

  const reset = () => {
    setType("freight");
    setLedgerId("");
    setValue("");
    setSign(1);
    setMode("amount");
    setStage("post_gst");
  };

  const onTypeChange = (v: SundryType) => {
    setType(v);
    setSign(defaultSignForType(v));
    setStage(defaultStageForType(v));
  };

  const confirm = () => {
    const num = parseFloat(value) || 0;
    if (!ledgerId || num === 0) return;
    // For percent, amount_paise is a placeholder; ItemVoucherForm recomputes
    // it against the current base. Its sign still carries the +/-.
    const amountPaise =
      mode === "percent"
        ? sign * 1 // placeholder magnitude, real value computed at totals time
        : rupeesToPaise(num) * sign;
    onAdd({
      id: crypto.randomUUID(),
      sundry_type: type,
      ledger_id: ledgerId,
      amount_paise: amountPaise,
      mode,
      rate_bps: mode === "percent" ? Math.round(num * 100) : 0,
      apply_stage: stage,
    });
    reset();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start text-xs text-muted-foreground hover:text-foreground"
          disabled={disabled}
        >
          <Plus className="mr-1 h-3 w-3" /> Add charge / discount
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <div className="space-y-1">
          <Label className="text-[11px]">Type</Label>
          <Select value={type} onValueChange={(v) => onTypeChange(v as SundryType)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SUNDRY_TYPE_LABELS) as SundryType[]).map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{SUNDRY_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Ledger</Label>
          <Select value={ledgerId} onValueChange={setLedgerId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select ledger" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {ledgerOptions.map((lg) => (
                <SelectItem key={lg.id} value={lg.id} className="text-xs">
                  {lg.name} <span className="text-muted-foreground">· {lg.type}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onCreateLedger && (
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={onCreateLedger}
            >
              + Create new ledger
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Apply</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                variant={stage === "pre_gst" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1 px-2 text-[11px]"
                onClick={() => setStage("pre_gst")}
                title="Folded into taxable value; GST recalculates"
              >Before GST</Button>
              <Button
                type="button"
                variant={stage === "post_gst" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1 px-2 text-[11px]"
                onClick={() => setStage("post_gst")}
                title="Added to grand total; no tax effect"
              >After GST</Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Mode</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                variant={mode === "amount" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1 px-2 text-[11px]"
                onClick={() => setMode("amount")}
              >₹</Button>
              <Button
                type="button"
                variant={mode === "percent" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1 px-2 text-[11px]"
                onClick={() => setMode("percent")}
              >%</Button>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{mode === "percent" ? "Percentage" : "Amount"}</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant={sign === 1 ? "default" : "outline"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setSign(1)}
              title="Adds to invoice total"
            >+</Button>
            <Button
              type="button"
              variant={sign === -1 ? "default" : "outline"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setSign(-1)}
              title="Reduces invoice total"
            >−</Button>
            <div className="relative flex-1">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 text-right font-mono text-xs pr-6"
                inputMode="decimal"
                placeholder={mode === "percent" ? "0.00" : "0.00"}
                autoFocus
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                {mode === "percent" ? "%" : "₹"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={confirm} disabled={!ledgerId || !value}>Add</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
