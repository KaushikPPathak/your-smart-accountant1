import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, FilterX } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ColumnFilter, DGColumn, FilterOp } from "./types";

interface Props<T> {
  col: DGColumn<T>;
  enumOptions: string[];
  current?: ColumnFilter;
  onApply: (f: ColumnFilter | null) => void;
}

const TEXT_OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "startsWith", label: "Starts with" },
  { value: "regex", label: "Regex" },
  { value: "blank", label: "Is blank" },
  { value: "notBlank", label: "Not blank" },
];
const NUM_OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "between", label: "Between" },
  { value: "blank", label: "Is blank" },
];
const DATE_OPS: { value: FilterOp; label: string }[] = [
  { value: "on", label: "On" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "dateBetween", label: "Between" },
  { value: "blank", label: "Is blank" },
];

export function ColumnFilterButton<T>({ col, enumOptions, current, onApply }: Props<T>) {
  const [open, setOpen] = useState(false);
  const type = col.type ?? "text";
  const active = !!current;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6 p-0", active && "text-primary")}
          title={active ? "Filter active" : "Filter"}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        {type === "enum" ? (
          <EnumFilter
            colId={col.id}
            options={enumOptions}
            value={(current?.value as string[]) ?? []}
            onApply={(values) => {
              onApply(values.length ? { id: col.id, op: "in", value: values } : null);
              setOpen(false);
            }}
          />
        ) : (
          <ScalarFilter
            colId={col.id}
            type={type}
            current={current}
            onApply={(f) => { onApply(f); setOpen(false); }}
          />
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-destructive"
            onClick={() => { onApply(null); setOpen(false); }}
          >
            <FilterX className="mr-2 h-4 w-4" /> Clear filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ScalarFilter({
  colId,
  type,
  current,
  onApply,
}: {
  colId: string;
  type: "text" | "number" | "date";
  current?: ColumnFilter;
  onApply: (f: ColumnFilter | null) => void;
}) {
  const ops = type === "number" ? NUM_OPS : type === "date" ? DATE_OPS : TEXT_OPS;
  const [op, setOp] = useState<FilterOp>(current?.op ?? ops[0].value);
  const [v1, setV1] = useState<string>(() => {
    if (current && Array.isArray(current.value)) return String((current.value as unknown[])[0] ?? "");
    return current?.value != null ? String(current.value) : "";
  });
  const [v2, setV2] = useState<string>(() => {
    if (current && Array.isArray(current.value)) return String((current.value as unknown[])[1] ?? "");
    return "";
  });

  const isRange = op === "between" || op === "dateBetween";
  const isBlank = op === "blank" || op === "notBlank";
  const inputType = type === "date" ? "date" : type === "number" ? "number" : "text";

  return (
    <div className="space-y-2">
      <Select value={op} onValueChange={(v) => setOp(v as FilterOp)}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ops.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {!isBlank && (
        <Input type={inputType} value={v1} onChange={(e) => setV1(e.target.value)} className="h-8" autoFocus />
      )}
      {isRange && (
        <Input type={inputType} value={v2} onChange={(e) => setV2(e.target.value)} className="h-8" placeholder="and" />
      )}
      <Button
        size="sm"
        className="w-full"
        onClick={() => {
          if (isBlank) onApply({ id: colId, op, value: null });
          else if (isRange) onApply({ id: colId, op, value: [v1, v2] });
          else if (v1 === "") onApply(null);
          else onApply({ id: colId, op, value: v1 });
        }}
      >Apply</Button>
    </div>
  );
}

function EnumFilter({
  colId: _colId,
  options,
  value,
  onApply,
}: {
  colId: string;
  options: string[];
  value: string[];
  onApply: (values: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(() => new Set(value));
  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  );

  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8" autoFocus />
      <div className="max-h-56 overflow-auto rounded border p-1">
        {filtered.length === 0 && <div className="p-2 text-xs text-muted-foreground">No matches</div>}
        {filtered.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
            <Checkbox
              checked={sel.has(o)}
              onCheckedChange={(c) => {
                const next = new Set(sel);
                if (c) next.add(o); else next.delete(o);
                setSel(next);
              }}
            />
            <span className="truncate">{o}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setSel(new Set(filtered))}>All</Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setSel(new Set())}>None</Button>
        <Button size="sm" className="flex-1" onClick={() => onApply([...sel])}>Apply</Button>
      </div>
    </div>
  );
}
