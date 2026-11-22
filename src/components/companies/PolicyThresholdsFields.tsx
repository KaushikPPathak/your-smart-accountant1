// Company settings: the policy thresholds. Values are written only through the company save path;
// this component holds form state and shows the validation. It never saves on its own.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_POLICY, policyToForm, type PolicyFormErrors, type PolicyFormValues } from "@/lib/policy-settings";

export function PolicyThresholdsFields({
  values,
  errors,
  sourceLine,
  onChange,
}: {
  values: PolicyFormValues;
  errors: PolicyFormErrors;
  sourceLine: string;
  onChange: (next: PolicyFormValues) => void;
}) {
  const set = (k: keyof PolicyFormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...values, [k]: e.target.value });

  const field = (k: keyof PolicyFormValues, label: string, hint: string, step: string) => (
    <div>
      <Label htmlFor={`policy-${k}`} className="text-xs">{label}</Label>
      <Input
        id={`policy-${k}`}
        name={`policy-${k}`}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={values[k]}
        onChange={set(k)}
        aria-invalid={!!errors[k]}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      {errors[k] && <p className="mt-1 text-xs text-red-600">{errors[k]}</p>}
    </div>
  );

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Policy thresholds</legend>
      <p className="text-xs text-muted-foreground">{sourceLine}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("stockAbsRupees", "Stock count variance floor (₹)", "A count difference above the higher of this or the rate below needs a reason.", "1")}
        {field("stockPct", "Stock count variance rate (fraction)", "0 to 1. For example 0.01 is 1% of the line value.", "0.0001")}
        {field("roundOffRupees", "Round-off absorbed automatically (₹)", "Up to ₹10. Larger round-offs are flagged for review.", "0.01")}
        {field("advanceRupees", "Advance receipt notice from (₹)", "Service advances at or above this show the GST-on-advance notice. Up to ₹10,000.", "1")}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange(policyToForm(DEFAULT_POLICY))}
      >
        Reset to defaults
      </Button>
    </fieldset>
  );
}
