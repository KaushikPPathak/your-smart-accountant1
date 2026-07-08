import { CheckCircle2, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Resolution, TaxTemplate } from "@/lib/voucher-resolver";

interface Props {
  resolution: Resolution<TaxTemplate>;
  manualId: string | null;
  onManualChange: (id: string | null) => void;
}

/**
 * Tax-template surface — progressive disclosure.
 *
 *   status = "hidden"      → renders nothing (no templates configured, or
 *                            party is unregistered/composition). Zero
 *                            visual weight on default forms.
 *   status = "auto"        → tiny read-only chip. No focus stop, no picker.
 *                            User can click it to override, but that's opt-in.
 *   status = "ambiguous"   → inline picker with amber highlight. Save is
 *   status = "unresolved"    disabled by the parent form until user picks.
 *
 * Never rendered as a required field on a happy-path Cash Sale.
 */
export function AutoTaxChip({ resolution, manualId, onManualChange }: Props) {
  if (resolution.status === "hidden") return null;

  if (resolution.status === "auto" && resolution.value) {
    const t = resolution.value;
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
        title={`Auto-selected from party + item. Click to override.`}
      >
        <CheckCircle2 className="h-3 w-3" />
        {t.name}
      </span>
    );
  }

  // ambiguous | unresolved → inline picker, Save disabled by parent
  const options = resolution.candidates ?? [];
  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
        title="Tax template can't be inferred — please pick one to enable Save."
      >
        <AlertCircle className="h-3 w-3" />
        Pick tax
      </span>
      <Select value={manualId ?? ""} onValueChange={(v) => onManualChange(v || null)}>
        <SelectTrigger className="h-6 w-40 text-[11px]">
          <SelectValue placeholder={
            resolution.status === "unresolved" ? "No match — pick" : "Multiple — pick"
          } />
        </SelectTrigger>
        <SelectContent>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id} className="text-xs">
              {t.name} ({t.gst_rate}%{t.is_interstate ? " · IGST" : ""})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
