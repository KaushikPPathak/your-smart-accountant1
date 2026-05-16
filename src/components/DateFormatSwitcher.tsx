import { CalendarDays } from "lucide-react";
import { DATE_FORMATS, useDateFormat, type DateFormatCode } from "@/lib/date-format";
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

export function DateFormatSwitcher({ compact, className }: Props) {
  const { code, setCode } = useDateFormat();
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      {!compact && (
        <span className="hidden text-xs text-muted-foreground sm:inline">Date</span>
      )}
      <Select value={code} onValueChange={(v) => setCode(v as DateFormatCode)}>
        <SelectTrigger className={compact ? "h-8 w-[140px]" : "h-9 w-[180px]"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_FORMATS.map((f) => (
            <SelectItem key={f.code} value={f.code}>
              <span className="flex items-center gap-2">
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">— {f.sample}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
