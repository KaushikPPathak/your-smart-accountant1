import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PrintLayout } from "@/lib/print-layout";

/** Toolbar switch: continuous printing vs. a new page per date / ledger. */
export function PrintLayoutToggle({ value, onChange, pagedLabel, label = "Printing" }: {
  value: PrintLayout;
  onChange: (v: PrintLayout) => void;
  pagedLabel: string;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as PrintLayout)}
        className="h-9 rounded-md border border-input bg-background p-0.5"
        aria-label={label}
      >
        <ToggleGroupItem value="continuous" className="px-3 text-xs">Continuous</ToggleGroupItem>
        <ToggleGroupItem value="paged" className="px-3 text-xs">{pagedLabel}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
