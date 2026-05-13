import { useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ColumnFilterButton } from "./ColumnFilter";
import { GridToolbar } from "./GridToolbar";
import { useGridState } from "./useGridState";
import { computeAggregates, deriveEnumValues, processRows, type FlatRow } from "./grid-engine";
import type { DGColumn, GridState } from "./types";

export interface DataGridProps<T> {
  rows: T[];
  columns: DGColumn<T>[];
  reportId: string;
  /** Function returning a string of all searchable fields for the global search box */
  globalSearch?: (row: T) => string;
  /** Click handler for body rows */
  onRowClick?: (row: T) => void;
  /** Optional secondary actions rendered in the toolbar (export buttons, view switcher…) */
  toolbarExtras?: ReactNode;
  /** Footer label cell, rendered in the first visible column */
  footerLabel?: ReactNode;
  className?: string;
  /** Pixel height of the body viewport */
  height?: number;
  /** Optional empty-state */
  empty?: ReactNode;
  /** Loading overlay */
  loading?: boolean;
  /** Override row height in px */
  rowHeight?: number;
  /** Expose the processed (filtered/sorted) rows to the parent (e.g. for export) */
  onProcessedChange?: (visibleRows: T[], aggregates: Record<string, number>) => void;
}

export function DataGrid<T>({
  rows,
  columns,
  reportId,
  globalSearch,
  onRowClick,
  toolbarExtras,
  footerLabel,
  className,
  height = 520,
  empty,
  loading,
  rowHeight,
  onProcessedChange,
}: DataGridProps<T>) {
  const { state, setState, reset, views, saveView, applyView, deleteView } = useGridState(reportId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleColumns = useMemo(
    () => columns.filter((c) => !state.hiddenCols.includes(c.id) && !c.hidden),
    [columns, state.hiddenCols],
  );

  const enumOptionsByCol = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (c.type === "enum") out[c.id] = deriveEnumValues(rows, c);
    }
    return out;
  }, [columns, rows]);

  const { flat, aggregates, visibleCount } = useMemo(
    () => processRows(rows, columns, state, expanded, globalSearch),
    [rows, columns, state, expanded, globalSearch],
  );

  // Notify parent (debounced via ref to avoid loops)
  const lastNotifyRef = useRef<{ rows: T[]; aggregates: Record<string, number> } | null>(null);
  const visibleData = useMemo(() => {
    if (!onProcessedChange) return null;
    return flat.filter((r): r is { kind: "row"; row: T; index: number } => r.kind === "row").map((r) => r.row);
  }, [flat, onProcessedChange]);
  if (onProcessedChange && visibleData && lastNotifyRef.current?.rows !== visibleData) {
    lastNotifyRef.current = { rows: visibleData, aggregates };
    queueMicrotask(() => onProcessedChange(visibleData, aggregates));
  }

  const parentRef = useRef<HTMLDivElement>(null);
  const rowH = rowHeight ?? (state.density === "compact" ? 28 : 36);

  // Filter out hidden group rows
  const renderRows: FlatRow<T>[] = useMemo(
    () => flat.filter((r) => r.kind === "row" || r.visible),
    [flat],
  );

  const virtualizer = useVirtualizer({
    count: renderRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 12,
  });

  const toggleSort = useCallback((id: string, additive: boolean) => {
    setState((s) => {
      const existing = s.sort.find((r) => r.id === id);
      let next = s.sort;
      if (!additive) {
        if (!existing) next = [{ id, dir: "asc" }];
        else if (existing.dir === "asc") next = [{ id, dir: "desc" }];
        else next = [];
      } else {
        if (!existing) next = [...s.sort, { id, dir: "asc" }];
        else if (existing.dir === "asc") next = s.sort.map((r) => r.id === id ? { id, dir: "desc" } : r);
        else next = s.sort.filter((r) => r.id !== id);
      }
      return { ...s, sort: next };
    });
  }, [setState]);

  const toggleGroup = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const setColFilter = useCallback((s: GridState, id: string, f: { id: string; op: string; value: unknown } | null) => {
    const without = s.filters.filter((x) => x.id !== id);
    return { ...s, filters: f ? [...without, f as never] : without };
  }, []);

  const cellAlign = (c: DGColumn<T>) =>
    c.align ?? (c.type === "number" ? "right" : "left");

  // Compute grid template columns
  const gridTemplate = useMemo(
    () => visibleColumns.map((c) => `${c.width ?? 160}px`).join(" "),
    [visibleColumns],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <GridToolbar
            columns={columns}
            state={state}
            setState={setState}
            reset={reset}
            views={views}
            saveView={saveView}
            applyView={applyView}
            deleteView={deleteView}
            filteredCount={visibleCount}
            totalCount={rows.length}
          />
        </div>
        {toolbarExtras && <div className="flex shrink-0 items-center gap-1">{toolbarExtras}</div>}
      </div>

      <div className="rounded-md border bg-card">
        {/* Header */}
        <div
          className="grid border-b bg-muted/40 text-xs font-medium uppercase tracking-wide overflow-x-auto"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {visibleColumns.map((c) => {
            const sortRule = state.sort.find((r) => r.id === c.id);
            const filter = state.filters.find((f) => f.id === c.id);
            return (
              <div
                key={c.id}
                className={cn(
                  "flex items-center gap-1 border-r px-2 py-1.5 select-none",
                  cellAlign(c) === "right" && "justify-end",
                  cellAlign(c) === "center" && "justify-center",
                )}
              >
                <button
                  className="flex items-center gap-1 truncate text-left hover:text-foreground"
                  onClick={(e) => toggleSort(c.id, e.shiftKey)}
                  title="Click to sort. Shift-click for multi-sort."
                >
                  <span className="truncate">{c.header}</span>
                  {sortRule?.dir === "asc" && <ArrowUp className="h-3 w-3" />}
                  {sortRule?.dir === "desc" && <ArrowDown className="h-3 w-3" />}
                </button>
                <ColumnFilterButton
                  col={c}
                  enumOptions={enumOptionsByCol[c.id] ?? []}
                  current={filter}
                  onApply={(f) => setState((s) => setColFilter(s, c.id, f))}
                />
              </div>
            );
          })}
        </div>

        {/* Body (virtualized) */}
        <div
          ref={parentRef}
          className="relative overflow-auto"
          style={{ height }}
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {!loading && renderRows.length === 0 && (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {empty ?? "No matching rows."}
            </div>
          )}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = renderRows[vi.index];
              const top = vi.start;
              if (item.kind === "group") {
                const colId = item.groupCol;
                const col = columns.find((c) => c.id === colId);
                const groupValue = item.key.split("=").slice(1).join("=");
                return (
                  <div
                    key={item.key}
                    className="absolute left-0 right-0 flex items-center border-b bg-muted/60 px-2 text-sm font-medium cursor-pointer hover:bg-muted"
                    style={{ top, height: rowH, paddingLeft: 8 + item.level * 16 }}
                    onClick={() => toggleGroup(item.key)}
                  >
                    {item.expanded ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                    <span className="mr-2 text-muted-foreground">{String(col?.header ?? colId)}:</span>
                    <span className="truncate">{groupValue}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({item.count})</span>
                    <div className="ml-auto flex gap-4">
                      {visibleColumns.filter((c) => c.aggregator).map((c) => (
                        <span key={c.id} className="font-mono tabular-nums text-xs">
                          {(c.formatGroupValue ?? c.formatAggregate ?? defaultFormat)(item.aggregates[c.id] ?? 0)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={vi.key}
                  className={cn(
                    "absolute left-0 right-0 grid border-b text-sm",
                    onRowClick && "cursor-pointer hover:bg-muted/50",
                  )}
                  style={{ top, height: rowH, gridTemplateColumns: gridTemplate }}
                  onClick={onRowClick ? () => onRowClick(item.row) : undefined}
                >
                  {visibleColumns.map((c) => (
                    <div
                      key={c.id}
                      className={cn(
                        "flex items-center truncate border-r px-2",
                        cellAlign(c) === "right" && "justify-end font-mono tabular-nums",
                        cellAlign(c) === "center" && "justify-center",
                      )}
                    >
                      <span className="truncate">
                        {c.cell ? c.cell(item.row) : asReact(c.accessor(item.row))}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        {visibleColumns.some((c) => c.aggregator) && (
          <div
            className="grid border-t bg-muted/50 text-sm font-semibold"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {visibleColumns.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  "border-r px-2 py-1.5 truncate",
                  cellAlign(c) === "right" && "text-right font-mono tabular-nums",
                  cellAlign(c) === "center" && "text-center",
                )}
              >
                {i === 0 && (footerLabel ?? "Total")}
                {c.aggregator && i !== 0 && (
                  c.formatAggregate ? c.formatAggregate(aggregates[c.id] ?? 0) : defaultFormat(aggregates[c.id] ?? 0)
                )}
                {i === 0 && c.aggregator && (
                  <span className="ml-2 font-mono tabular-nums">
                    {c.formatAggregate ? c.formatAggregate(aggregates[c.id] ?? 0) : defaultFormat(aggregates[c.id] ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function defaultFormat(v: number): string {
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString();
}

function asReact(v: unknown): ReactNode {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// re-exports for convenience
export { computeAggregates } from "./grid-engine";
export type { DGColumn } from "./types";
