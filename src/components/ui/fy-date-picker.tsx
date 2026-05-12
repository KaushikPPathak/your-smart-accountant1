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

  /**
   * Parse partial input into ISO. Accepts:
   *  - separators: "/", "-", ".", space  (e.g. "15", "15/5", "15-05-2026")
   *  - pure digits: "ddmm" (4), "ddmmyy" (6), "ddmmyyyy" (8)
   * When year is omitted, picks the FY year automatically (Apr–Dec → FY start
   * year, Jan–Mar → FY end year).
   */
  function tryParse(input: string): string | null {
    const s = input.trim();
    if (!s) return null;

    let dd: number, mm: number, yyyy: number | null = null;

    // Pure-digit fast path: ddmm / ddmmyy / ddmmyyyy
    if (/^\d+$/.test(s)) {
      if (s.length === 4) {
        dd = parseInt(s.slice(0, 2), 10);
        mm = parseInt(s.slice(2, 4), 10);
      } else if (s.length === 6) {
        dd = parseInt(s.slice(0, 2), 10);
        mm = parseInt(s.slice(2, 4), 10);
        yyyy = 2000 + parseInt(s.slice(4, 6), 10);
      } else if (s.length === 8) {
        dd = parseInt(s.slice(0, 2), 10);
        mm = parseInt(s.slice(2, 4), 10);
        yyyy = parseInt(s.slice(4, 8), 10);
      } else {
        return null;
      }
    } else {
      const parts = s.split(/[\/\-\.\s]+/).filter(Boolean);
      if (parts.length < 2) return null;
      dd = parseInt(parts[0], 10);
      mm = parseInt(parts[1], 10);
      if (parts[2]) {
        let y = parseInt(parts[2], 10);
        if (isNaN(y)) return null;
        if (y < 100) y += 2000;
        yyyy = y;
      }
    }

    if (!dd || !mm || dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    if (yyyy === null) {
      // Auto-pick FY year: months Apr–Dec → FY start year, Jan–Mar → FY end year
      yyyy = mm >= start.getMonth() + 1 ? start.getFullYear() : end.getFullYear();
    }
    const d = new Date(yyyy, mm - 1, dd);
    if (!isValid(d) || d.getDate() !== dd || d.getMonth() !== mm - 1) return null;
    return format(d, "yyyy-MM-dd");
  }

  /** Move focus to the next focusable form control after this picker. */
  function advanceFocus() {
    const root = (containerRef.current?.closest<HTMLElement>(
      '[data-enter-tab-root], form, body',
    )) ?? document.body;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    const me = containerRef.current?.querySelector<HTMLElement>("input");
    const idx = me ? focusables.indexOf(me) : -1;
    const next = idx >= 0 ? focusables[idx + 1] : undefined;
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
        try { next.select(); } catch { /* noop */ }
      }
    }
  }

  function commitText(v: string, opts?: { advance?: boolean }) {
    if (!v.trim()) {
      onChange("");
      return;
    }
    const iso = tryParse(v);
    if (iso) {
      onChange(iso);
      setText(fmtIndianDate(iso));
      if (opts?.advance) requestAnimationFrame(() => advanceFocus());
    } else {
      // revert
      setText(selected ? fmtIndianDate(value) : "");
    }
  }

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  /** Auto-commit & advance when the user types a complete pure-digit date. */
  function handleChange(v: string) {
    setText(v);
    const digitsOnly = /^\d+$/.test(v.trim());
    if (digitsOnly && (v.trim().length === 4 || v.trim().length === 6 || v.trim().length === 8)) {
      const iso = tryParse(v.trim());
      if (iso) {
        onChange(iso);
        setText(fmtIndianDate(iso));
        requestAnimationFrame(() => advanceFocus());
      }
    }
  }

  return (
    <div ref={containerRef} className={cn("relative flex items-center", className)}>
      <Input
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? "DDMM"}
        inputMode="numeric"
        onChange={(e) => handleChange(e.target.value)}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText((e.target as HTMLInputElement).value, { advance: true });
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
