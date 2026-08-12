import { Coins } from "lucide-react";
import { CURRENCIES, useCurrency } from "@/lib/currency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  compact?: boolean;
  className?: string;
}

export function CurrencySwitcher({ compact, className }: Props) {
  const { code, setCode } = useCurrency();
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Coins className="h-4 w-4 text-muted-foreground" />
      {!compact && (
        <span className="hidden text-xs text-muted-foreground sm:inline">Currency</span>
      )}
      <Select value={code} onValueChange={setCode}>
        <SelectTrigger className={compact ? "h-8 w-[110px]" : "h-9 w-[140px]"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[340px]">
          {CURRENCIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{c.symbol}</span>
                <span>{c.code}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">— {c.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
