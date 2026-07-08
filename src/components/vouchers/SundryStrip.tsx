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
  defaultSignForType,
  type Sundry,
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
 * Progressive disclosure: renders as a single small button when the list is
 * empty. Rows only appear once the user has added something. No permanent
 * chip strip cluttering the default form.
 *
 * Ledger options should be scoped to expense/income heads (indirect / direct)
 * — the caller filters. Sign convention lives in `src/lib/sundries.ts`.
 */
export function SundryStrip({ sundries, onChange, ledgerOptions, onCreateLedger, disabled }: Props) {
  return (
    <div className="space-y-1">
      {sundries.length > 0 && (
        <div className="space-y-1">
          {sundries.map((s) => {
            const lg = ledgerOptions.find((l) => l.id === s.ledger_id);
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex-1 min-w-0 truncate text-muted-foreground">
                  <span className="font-medium text-foreground">{SUNDRY_TYPE_LABELS[s.sundry_type]}</span>
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
  const [amount, setAmount] = useState<string>("");
  const [sign, setSign] = useState<1 | -1>(1);

  const reset = () => {
    setType("freight");
    setLedgerId("");
    setAmount("");
    setSign(1);
  };

  const onTypeChange = (v: SundryType) => {
    setType(v);
    setSign(defaultSignForType(v));
  };

  const confirm = () => {
    const paise = rupeesToPaise(parseFloat(amount) || 0) * sign;
    if (!ledgerId || paise === 0) return;
    onAdd({
      id: crypto.randomUUID(),
      sundry_type: type,
      ledger_id: ledgerId,
      amount_paise: paise,
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
          <Plus className="mr-1 h-3 w-3" /> Add charge
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
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
        <div className="space-y-1">
          <Label className="text-[11px]">Amount</Label>
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
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 text-right font-mono text-xs"
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={confirm} disabled={!ledgerId || !amount}>Add</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
