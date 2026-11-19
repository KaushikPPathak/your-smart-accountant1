// Report period picker for the GST screens: a single month, a quarter, any
// number of months from a start month, or any date range. Controls are
// touch-sized on phones and stack in one column.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GstPeriodMode, GstPeriodSelection, ResolvedGstPeriod } from "@/lib/gst-period";

const MODES: { value: GstPeriodMode; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "months", label: "Number of months" },
  { value: "range", label: "Date range" },
];

export function GstPeriodPicker({
  value,
  onChange,
  resolved,
}: {
  value: GstPeriodSelection;
  onChange: (next: GstPeriodSelection) => void;
  resolved: ResolvedGstPeriod;
}) {
  const set = (patch: Partial<GstPeriodSelection>) => onChange({ ...value, ...patch });
  const field = "space-y-1 w-full sm:w-auto";
  const control = "h-11 w-full sm:h-9 sm:w-[180px]";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className={field}>
          <Label className="text-xs">Period type</Label>
          <Select value={value.mode} onValueChange={(v) => set({ mode: v as GstPeriodMode })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {value.mode === "month" && (
          <div className={field}>
            <Label className="text-xs">Month</Label>
            <Input type="month" className={control} value={value.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
          </div>
        )}

        {value.mode === "quarter" && (
          <>
            <div className={field}>
              <Label className="text-xs">Quarter</Label>
              <Select value={String(value.quarter)} onValueChange={(v) => set({ quarter: Number(v) as 1 | 2 | 3 | 4 })}>
                <SelectTrigger className={control}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Q1 (Apr–Jun)</SelectItem>
                  <SelectItem value="2">Q2 (Jul–Sep)</SelectItem>
                  <SelectItem value="3">Q3 (Oct–Dec)</SelectItem>
                  <SelectItem value="4">Q4 (Jan–Mar)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={field}>
              <Label className="text-xs">Year</Label>
              <Input type="number" inputMode="numeric" className="h-11 w-full sm:h-9 sm:w-[120px]" value={value.quarterYear}
                onChange={(e) => { const y = Number(e.target.value); if (y >= 2000 && y <= 2100) set({ quarterYear: y }); }} />
            </div>
          </>
        )}

        {value.mode === "months" && (
          <>
            <div className={field}>
              <Label className="text-xs">Start month</Label>
              <Input type="month" className={control} value={value.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
            </div>
            <div className={field}>
              <Label className="text-xs">Number of months</Label>
              <Input type="number" inputMode="numeric" min={1} max={60} className="h-11 w-full sm:h-9 sm:w-[120px]" value={value.count}
                onChange={(e) => set({ count: Math.min(60, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) })} />
            </div>
          </>
        )}

        {value.mode === "range" && (
          <>
            <div className={field}>
              <Label className="text-xs">From</Label>
              <Input type="date" className={control} value={value.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className={field}>
              <Label className="text-xs">To</Label>
              <Input type="date" className={control} value={value.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {resolved.valid ? (
          <>
            Showing <strong className="text-foreground">{resolved.label}</strong> · {resolved.from} to {resolved.to}
            {resolved.months > 1 ? ` · ${resolved.months} months` : ""}
            {!resolved.singleReturn && " · review range: filing files are for a single month or quarter"}
          </>
        ) : (
          <span className="text-destructive">The end date must be on or after the start date.</span>
        )}
      </p>
    </div>
  );
}
