import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

/**
 * Bill-level GST amount that the user may overwrite to match the supplier's
 * rounding. Empty input or "auto" restores the calculated value.
 */
export function GstAmountRow({
  label,
  paise,
  overridden,
  onCommit,
}: {
  label: string;
  paise: number;
  overridden: boolean;
  onCommit: (value: string | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = (paise / 100).toFixed(2);
    }
  }, [paise]);
  const commit = (raw: string) => {
    const v = raw.replace(/[^0-9.]/g, "");
    onCommit(v === "" ? undefined : v);
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">
        {label}
        {overridden && (
          <button
            type="button"
            className="ml-1 text-xs underline"
            title="Restore calculated amount"
            onClick={() => onCommit(undefined)}
          >
            (auto)
          </button>
        )}
      </span>
      <Input
        ref={ref}
        aria-label={`${label} amount`}
        className="h-7 w-32 text-right font-mono"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={(paise / 100).toFixed(2)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
        }}
      />
    </div>
  );
}
