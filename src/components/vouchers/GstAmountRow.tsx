import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [draft, setDraft] = useState((paise / 100).toFixed(2));
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft((paise / 100).toFixed(2));
  }, [paise]);
  const commit = (raw: string) => {
    if (!dirty.current) return;
    dirty.current = false;
    const v = raw.replace(/[^0-9.]/g, "");
    onCommit(v === "" ? undefined : v);
    setDraft(v === "" ? (paise / 100).toFixed(2) : v);
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">
        {label}
        {overridden && (
          <Button
            type="button"
            variant="link"
            className="ml-1 h-auto p-0 text-xs underline"
            title="Restore calculated amount"
            onClick={() => { dirty.current = false; onCommit(undefined); }}
          >
            (auto)
          </Button>
        )}
      </span>
      <Input
        ref={ref}
        aria-label={`${label} amount`}
        className="h-7 w-32 text-right font-mono"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
        }}
      />
    </div>
  );
}
