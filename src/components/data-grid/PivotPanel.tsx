import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DGColumn, Aggregator } from "./types";
import type { PivotConfig, PivotResult, PivotValueSpec } from "./pivot-engine";
import { downloadCsv } from "@/lib/csv";

interface Props<T> {
  columns: DGColumn<T>[];
  config: PivotConfig;
  setConfig: (c: PivotConfig) => void;
  result: PivotResult | null;
  loading: boolean;
  error: string | null;
  ms: number;
  /** Total source rows (after grid filters) */
  sourceCount: number;
  /** Disable pivot mode */
  onExit: () => void;
}

const AGGS: Aggregator[] = ["sum", "count", "avg", "min", "max"];

export function PivotPanel<T>({
  columns,
  config,
  setConfig,
  result,
  loading,
  error,
  ms,
  sourceCount,
  onExit,
}: Props<T>) {
  const colsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const numericCols = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);
  const dimCols = useMemo(() => columns.filter((c) => c.type !== "number"), [columns]);

  const label = (id: string) => String(colsById.get(id)?.header ?? id);

  const addRow = (id: string) => setConfig({ ...config, rows: dedupe([...config.rows, id]) });
  const addCol = (id: string) => setConfig({ ...config, cols: dedupe([...config.cols, id]) });
  const addValue = (id: string) => {
    if (config.values.some((v) => v.id === id)) return;
    setConfig({ ...config, values: [...config.values, { id, agg: "sum" }] });
  };
  const removeRow = (id: string) => setConfig({ ...config, rows: config.rows.filter((x) => x !== id) });
  const removeCol = (id: string) => setConfig({ ...config, cols: config.cols.filter((x) => x !== id) });
  const removeValue = (id: string) => setConfig({ ...config, values: config.values.filter((v) => v.id !== id) });
  const changeValueAgg = (id: string, agg: Aggregator) =>
    setConfig({ ...config, values: config.values.map((v) => v.id === id ? { ...v, agg } : v) });
  const reset = () => setConfig({ rows: [], cols: [], values: [] });

  const exportCsv = () => {
    if (!result) return;
    const rows = pivotToCsvRows(result, label);
    downloadCsv("pivot.csv", rows.head, rows.body);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Field pickers */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pivot</span>

        <FieldPicker label="Rows" options={dimCols} selected={config.rows} onAdd={addRow} />
        {config.rows.map((id) => (
          <Badge key={`r-${id}`} variant="secondary" className="gap-1">
            R: {label(id)}
            <X className="h-3 w-3 cursor-pointer" onClick={() => removeRow(id)} />
          </Badge>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />

        <FieldPicker label="Cols" options={dimCols} selected={config.cols} onAdd={addCol} />
        {config.cols.map((id) => (
          <Badge key={`c-${id}`} variant="secondary" className="gap-1">
            C: {label(id)}
            <X className="h-3 w-3 cursor-pointer" onClick={() => removeCol(id)} />
          </Badge>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />

        <FieldPicker label="Values" options={numericCols} selected={config.values.map((v) => v.id)} onAdd={addValue} />
        {config.values.map((v) => (
          <Badge key={`v-${v.id}`} variant="secondary" className="gap-1">
            {label(v.id)}
            <Select value={v.agg} onValueChange={(a) => changeValueAgg(v.id, a as Aggregator)}>
              <SelectTrigger className="h-5 w-[68px] border-0 bg-transparent px-1 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <X className="h-3 w-3 cursor-pointer" onClick={() => removeValue(v.id)} />
          </Badge>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={reset} className="h-7">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={exportCsv} className="h-7" disabled={!result}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={onExit} className="h-7">Exit pivot</Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {sourceCount.toLocaleString()} source rows
          {result && ` • ${result.rowsCount} × ${result.colsCount} cells in ${Math.round(ms)} ms`}
          {result?.capped && <span className="ml-2 text-amber-600">• output capped — narrow the filter</span>}
        </span>
        {loading && <span>Computing…</span>}
        {error && <span className="text-destructive">{error}</span>}
      </div>

      <PivotGrid result={result} label={label} loading={loading} />
    </div>
  );
}

function dedupe(a: string[]) { return [...new Set(a)]; }

function FieldPicker<T>({
  label,
  options,
  selected,
  onAdd,
}: {
  label: string;
  options: DGColumn<T>[];
  selected: string[];
  onAdd: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7">
          <Plus className="mr-1 h-3.5 w-3.5" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-auto">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        {options.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">No suitable columns</div>
        )}
        {options.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={selected.includes(c.id)}
            onCheckedChange={(checked) => { if (checked) onAdd(c.id); }}
          >
            {String(c.header)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const fmt = (v: number) => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

function PivotGrid({
  result,
  label,
  loading,
}: {
  result: PivotResult | null;
  label: (id: string) => string;
  loading: boolean;
}) {
  // call hooks unconditionally
  const ref = useState<HTMLDivElement | null>(null);
  const setRef = ref[1];
  const el = ref[0];

  const R = result?.rowsCount ?? 0;
  const V = result?.values.length ?? 0;
  const C = result?.colsCount ?? 0;

  const virt = useVirtualizer({
    count: R,
    getScrollElement: () => el,
    estimateSize: () => 28,
    overscan: 12,
  });

  if (!result) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
        {loading ? "Computing pivot…" : "Pick Rows / Columns / Values to build the pivot."}
      </div>
    );
  }

  const colWidth = 120;
  const rowHeaderWidth = Math.max(180, (result.rowPaths[0]?.length ?? 1) * 140);
  const totalWidth = rowHeaderWidth + (C + 1) * V * colWidth; // +1 for row totals

  return (
    <div className="rounded-md border bg-card">
      {/* Header */}
      <div className="overflow-auto">
        <div style={{ width: totalWidth }} className="border-b bg-muted/40 text-xs">
          {/* Top: col path headers */}
          {result.colPaths[0] && result.colPaths[0].map((_, lvl) => (
            <div
              key={`hdr-${lvl}`}
              className="grid"
              style={{ gridTemplateColumns: `${rowHeaderWidth}px repeat(${C}, ${V * colWidth}px) ${V * colWidth}px` }}
            >
              <div className="border-r px-2 py-1 font-medium uppercase tracking-wide">
                {lvl === 0 ? "" : ""}
              </div>
              {result.colPaths.map((p, ci) => (
                <div key={`h-${lvl}-${ci}`} className="truncate border-r px-2 py-1 text-center" title={p.join(" / ")}>
                  {p[lvl] ?? ""}
                </div>
              ))}
              <div className="border-r bg-muted px-2 py-1 text-center font-semibold">
                {lvl === 0 ? "Total" : ""}
              </div>
            </div>
          ))}
          {/* Value row */}
          <div
            className="grid border-t"
            style={{ gridTemplateColumns: `${rowHeaderWidth}px repeat(${(C + 1) * V}, ${colWidth}px)` }}
          >
            <div className="border-r px-2 py-1 font-medium uppercase tracking-wide text-muted-foreground">
              {result.rowPaths[0]?.map((_, lvl) => `L${lvl + 1}`).join(" / ") || "Rows"}
            </div>
            {Array.from({ length: C + 1 }).flatMap((_, ci) =>
              result.values.map((v, vi) => (
                <div key={`vh-${ci}-${vi}`} className="truncate border-r px-2 py-1 text-right font-mono text-[10px] uppercase">
                  {label(v.id)} · {v.agg}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Body */}
        <div ref={setRef} className="relative max-h-[460px] overflow-auto" style={{ width: totalWidth }}>
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Recomputing…
            </div>
          )}
          <div style={{ height: virt.getTotalSize(), width: "100%", position: "relative" }}>
            {virt.getVirtualItems().map((vi) => {
              const r = vi.index;
              const path = result.rowPaths[r];
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 right-0 grid border-b text-sm hover:bg-muted/40"
                  style={{
                    top: vi.start,
                    height: 28,
                    gridTemplateColumns: `${rowHeaderWidth}px repeat(${(C + 1) * V}, ${colWidth}px)`,
                  }}
                >
                  <div className="truncate border-r px-2 py-1" title={path.join(" / ")}>
                    {path.join(" › ")}
                  </div>
                  {Array.from({ length: C }).map((_, c) =>
                    result.values.map((_v, vi2) => {
                      const cell = result.matrix[(r * C + c) * V + vi2];
                      return (
                        <div key={`m-${c}-${vi2}`} className="truncate border-r px-2 py-1 text-right font-mono tabular-nums">
                          {cell ? fmt(cell) : ""}
                        </div>
                      );
                    })
                  )}
                  {/* row totals */}
                  {result.values.map((_v, vi2) => (
                    <div key={`rt-${vi2}`} className="truncate border-r bg-muted/40 px-2 py-1 text-right font-mono font-semibold tabular-nums">
                      {fmt(result.rowTotals[r * V + vi2])}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer: col totals + grand */}
        <div
          className="grid border-t bg-muted/50 text-sm font-semibold"
          style={{ gridTemplateColumns: `${rowHeaderWidth}px repeat(${(C + 1) * V}, ${colWidth}px)` }}
        >
          <div className="border-r px-2 py-1">Total</div>
          {Array.from({ length: C }).map((_, c) =>
            result.values.map((_v, vi2) => (
              <div key={`ct-${c}-${vi2}`} className="truncate border-r px-2 py-1 text-right font-mono tabular-nums">
                {fmt(result.colTotals[c * V + vi2])}
              </div>
            ))
          )}
          {result.values.map((_v, vi2) => (
            <div key={`gt-${vi2}`} className={cn("truncate border-r bg-muted px-2 py-1 text-right font-mono tabular-nums")}>
              {fmt(result.grandTotals[vi2])}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function pivotToCsvRows(result: PivotResult, label: (id: string) => string) {
  const V = result.values.length;
  const head = [
    ...(result.rowPaths[0]?.map((_, i) => `Row L${i + 1}`) ?? ["Row"]),
    ...result.colPaths.flatMap((p) => result.values.map((v) => `${p.join(" / ")} · ${label(v.id)} (${v.agg})`)),
    ...result.values.map((v) => `Total · ${label(v.id)} (${v.agg})`),
  ];
  const body = result.rowPaths.map((path, r) => {
    const cells: (string | number)[] = [...path];
    for (let c = 0; c < result.colsCount; c++) {
      for (let v = 0; v < V; v++) cells.push(result.matrix[(r * result.colsCount + c) * V + v]);
    }
    for (let v = 0; v < V; v++) cells.push(result.rowTotals[r * V + v]);
    return cells;
  });
  return { head, body };
}
