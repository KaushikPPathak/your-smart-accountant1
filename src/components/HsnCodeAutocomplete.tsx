import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { suggestHsn, type HsnRecord } from "@/services/hsnService";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onResolved?: (rec: HsnRecord) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

/**
 * Reusable HSN/SAC autocomplete bound to the local SQLite hsn_master table.
 * Shows a prefix-match dropdown after 2 characters so users can browse common
 * chapter heads (e.g. "48" → all paper codes including 4802).
 */
export function HsnCodeAutocomplete({
  value, onChange, onResolved, id, placeholder = "Type 2+ digits…", className,
}: Props) {
  const [suggestions, setSuggestions] = useState<HsnRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = (value || "").trim();
    if (q.length < 2) {
      setSuggestions([]);
      setNotFound(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const rows = await suggestHsn(q, 15);
        if (cancelled) return;
        setSuggestions(rows);
        setNotFound(rows.length === 0 && q.length >= 4);
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setNotFound(true);
        }
      }
    }, 150);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (rec: HsnRecord) => {
    onChange(rec.hsn_code);
    onResolved?.(rec);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <Input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        maxLength={10}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {suggestions.map((rec) => {
            const rate = rec.is_exempt ? 0 : (rec.igst_rate || rec.cgst_rate + rec.sgst_rate);
            return (
              <button
                key={rec.hsn_code}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(rec); }}
                className="w-full text-left p-2 text-xs hover:bg-accent hover:text-accent-foreground border-b last:border-0 flex flex-col gap-0.5"
              >
                <div className="flex justify-between font-mono font-semibold">
                  <span>{rec.hsn_code}</span>
                  <span className="text-muted-foreground text-[10px]">
                    {rec.is_exempt ? "Exempt" : `GST ${rate}%`}
                  </span>
                </div>
                <span className="text-muted-foreground truncate">{rec.description}</span>
              </button>
            );
          })}
        </div>
      )}
      {notFound && !open && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          HSN code not found in master database.
        </p>
      )}
    </div>
  );
}
