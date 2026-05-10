import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/lib/company-context";
import { fmtIndianDate } from "@/lib/format-date";

/**
 * Returns the active financial year [start, end] for the active company.
 * Falls back to the FY containing today if no company context.
 */
export function useFyRange(): { start: Date; end: Date } {
  const { activeMembership } = useCompany();
  return React.useMemo(() => {
    const fyStartStr = activeMembership?.companies?.financial_year_start;
    let start: Date;
    if (fyStartStr) {
      const parsed = parse(fyStartStr, "yyyy-MM-dd", new Date());
      start = isValid(parsed) ? parsed : fallbackFyStart();
    } else {
      start = fallbackFyStart();
    }
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
    return { start, end };
  }, [activeMembership?.companies?.financial_year_start]);
}

function fallbackFyStart(): Date {
  const now = new Date();
  const y = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return new Date(y, 3, 1);
}

/** Default ISO date string clamped into the active FY. */
export function useDefaultFyDate(): string {
  const { start, end } = useFyRange();
  return React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // If today falls inside the active FY, prefill it.
    // Otherwise return blank so the user can type DD/MM and the picker
    // will auto-fill the FY year.
    if (today >= start && today <= end) {
      return format(today, "yyyy-MM-dd");
    }
    return "";
  }, [start, end]);
}

interface Props {
  value: string; // ISO yyyy-MM-dd
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** If true, do not constrain to FY range. */
  unrestricted?: boolean;
}

export function FyDatePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = "Pick a date",
  unrestricted,
}: Props) {
  const { start, end } = useFyRange();
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const defaultMonth = selected ?? start;

  const [text, setText] = React.useState<string>(selected ? fmtIndianDate(value) : "");
  React.useEffect(() => {
    setText(selected ? fmtIndianDate(value) : "");
  }, [selected, value]);

  /** Parse partial input like "15", "15/5", "15/5/26", "15-05-2025" into ISO. */
  function tryParse(input: string): string | null {
    const s = input.trim();
    if (!s) return null;
    const parts = s.split(/[\/\-\.\s]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const dd = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (!dd || !mm || dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    let yyyy: number;
    if (parts[2]) {
      let y = parseInt(parts[2], 10);
      if (isNaN(y)) return null;
      if (y < 100) y += 2000;
      yyyy = y;
    } else {
      // Auto-pick FY year: months Apr–Dec → FY start year, Jan–Mar → FY end year
      yyyy = mm >= start.getMonth() + 1 ? start.getFullYear() : end.getFullYear();
    }
    const d = new Date(yyyy, mm - 1, dd);
    if (!isValid(d) || d.getDate() !== dd || d.getMonth() !== mm - 1) return null;
    return format(d, "yyyy-MM-dd");
  }

  function commitText(v: string) {
    if (!v.trim()) {
      onChange("");
      return;
    }
    const iso = tryParse(v);
    if (iso) {
      onChange(iso);
      setText(fmtIndianDate(iso));
    } else {
      // revert
      setText(selected ? fmtIndianDate(value) : "");
    }
  }

  return (
    <div className={cn("relative flex items-center", className)}>
      <Input
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? "DD/MM"}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText((e.target as HTMLInputElement).value);
          }
        }}
        className="h-9 pr-9"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="absolute right-0 top-0 h-9 w-9 text-muted-foreground"
            aria-label="Open calendar"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={defaultMonth}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          captionLayout="dropdown"
          startMonth={unrestricted ? undefined : start}
          endMonth={unrestricted ? undefined : end}
          disabled={unrestricted ? undefined : { before: start, after: end }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
      </Popover>
    </div>
  );
}
