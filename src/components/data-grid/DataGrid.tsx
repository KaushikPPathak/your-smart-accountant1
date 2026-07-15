import { useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, TableProperties, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ColumnFilterButton } from "./ColumnFilter";
import { GridToolbar } from "./GridToolbar";
import { useGridState } from "./useGridState";
import { computeAggregates, deriveEnumValues, processRows, type FlatRow } from "./grid-engine";
import { PivotPanel } from "./PivotPanel";
import { usePivot } from "./usePivot";
import type { DGColumn, GridState, PivotStatePersisted } from "./types";

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
  const { state, setState, reset, views, saveView, applyView, deleteView, setDefaultView } = useGridState(reportId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reorder columns: pinned-left first, then the rest. Hidden columns stripped.
  const visibleColumns = useMemo(() => {
    const shown = columns.filter((c) => !state.hiddenCols.includes(c.id) && !c.hidden);
    const pinIds = state.pinnedLeft ?? [];
    const pinned = pinIds
      .map((id) => shown.find((c) => c.id === id))
      .filter((c): c is DGColumn<T> => !!c);
    const rest = shown.filter((c) => !pinIds.includes(c.id));
    return [...pinned, ...rest];
  }, [columns, state.hiddenCols, state.pinnedLeft]);

  const pinnedCount = (state.pinnedLeft ?? []).filter((id) =>
    visibleColumns.some((c) => c.id === id)
  ).length;

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

  // Filtered rows (without grouping) feed both the parent callback and the pivot engine
  const filteredRows = useMemo(
    () => flat.filter((r): r is { kind: "row"; row: T; index: number } => r.kind === "row").map((r) => r.row),
    [flat],
  );

  // Notify parent (debounced via ref to avoid loops)
  const lastNotifyRef = useRef<{ rows: T[]; aggregates: Record<string, number> } | null>(null);
  if (onProcessedChange && lastNotifyRef.current?.rows !== filteredRows) {
    lastNotifyRef.current = { rows: filteredRows, aggregates };
    queueMicrotask(() => onProcessedChange(filteredRows, aggregates));
  }

  // Pivot state/config
  const pivotState: PivotStatePersisted = state.pivot ?? { enabled: false, rows: [], cols: [], values: [] };
  const pivotEnabled = !!pivotState.enabled;
  const setPivot = useCallback((p: PivotStatePersisted) => {
    setState((s) => ({ ...s, pivot: p }));
  }, [setState]);
  const pivotConfig = useMemo(
    () => ({ rows: pivotState.rows, cols: pivotState.cols, values: pivotState.values }),
    [pivotState.rows, pivotState.cols, pivotState.values],
  );
  const pivot = usePivot({ rows: filteredRows, columns, config: pivotConfig, enabled: pivotEnabled });

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

  // Column widths (with persisted overrides) — intrinsic (author-requested) size.
  const colWidth = useCallback((c: DGColumn<T>) => {
    const w = state.colWidths?.[c.id];
    if (typeof w === "number" && w > 0) return w;
    return c.width ?? 160;
  }, [state.colWidths]);

  // Measure the outer container so we can auto-fit columns to available width.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Displayed widths: scale intrinsic widths to fit container (grow or shrink).
  // Honors per-column minWidth (default 60px) as a floor when shrinking.
  const displayWidths = useMemo(() => {
    const intrinsic = visibleColumns.map((c) => colWidth(c));
    const total = intrinsic.reduce((s, w) => s + w, 0);
    if (containerWidth <= 0 || total <= 0) {
      const out: Record<string, number> = {};
      visibleColumns.forEach((c, i) => { out[c.id] = intrinsic[i]; });
      return out;
    }
    // Reserve ~2px per column for borders so the row fits without a scrollbar.
    const target = Math.max(0, containerWidth - visibleColumns.length * 2);
    const scale = target / total;
    const out: Record<string, number> = {};
    visibleColumns.forEach((c, i) => {
      const min = c.minWidth ?? 60;
      out[c.id] = Math.max(min, Math.round(intrinsic[i] * scale));
    });
    return out;
  }, [visibleColumns, colWidth, containerWidth]);

  const dispW = useCallback((c: DGColumn<T>) => displayWidths[c.id] ?? colWidth(c), [displayWidths, colWidth]);

  // Compute grid template columns
  const gridTemplate = useMemo(
    () => visibleColumns.map((c) => `${dispW(c)}px`).join(" "),
    [visibleColumns, dispW],
  );

  // Pinned column left offsets (px)
  const pinnedOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    for (let i = 0; i < pinnedCount; i++) {
      const c = visibleColumns[i];
      offsets[c.id] = acc;
      acc += dispW(c);
    }
    return offsets;
  }, [visibleColumns, pinnedCount, dispW]);

  // Resize handler
  const onResizeStart = useCallback((e: React.PointerEvent, col: DGColumn<T>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidth(col);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(col.minWidth ?? 60, Math.round(startW + (ev.clientX - startX)));
      setState((s) => ({ ...s, colWidths: { ...(s.colWidths ?? {}), [col.id]: next } }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [colWidth, setState]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && target === searchInputRef.current) {
        setState((s) => ({ ...s, search: "" }));
        searchInputRef.current?.blur();
      } else if (e.key === "R" && e.shiftKey && !inField) {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset, setState]);

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-2", className)}>
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
            setDefaultView={setDefaultView}
            filteredCount={visibleCount}
            totalCount={rows.length}
            searchInputRef={searchInputRef}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={pivotEnabled ? "default" : "outline"}
            className="h-8"
            onClick={() => setPivot({ ...pivotState, enabled: !pivotEnabled })}
            title="Toggle pivot mode"
          >
            <TableProperties className="mr-1 h-3.5 w-3.5" /> Pivot
          </Button>
          {toolbarExtras}
        </div>
      </div>

      {pivotEnabled ? (
        <PivotPanel
          columns={columns}
          config={pivotConfig}
          setConfig={(c) => setPivot({ ...pivotState, rows: c.rows, cols: c.cols, values: c.values })}
          result={pivot.result}
          loading={pivot.loading}
          error={pivot.error}
          ms={pivot.ms}
          sourceCount={filteredRows.length}
          onExit={() => setPivot({ ...pivotState, enabled: false })}
        />
      ) : (
      <div className="rounded-md border bg-card">
        {/* Header */}
        <div
          className="grid border-b bg-muted/40 text-xs font-medium uppercase tracking-wide overflow-x-auto"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {visibleColumns.map((c, idx) => {
            const sortRule = state.sort.find((r) => r.id === c.id);
            const filter = state.filters.find((f) => f.id === c.id);
            const isPinned = idx < pinnedCount;
            return (
              <div
                key={c.id}
                className={cn(
                  "relative flex items-center gap-1 border-r px-2 py-1.5 select-none",
                  cellAlign(c) === "right" && "justify-end",
                  cellAlign(c) === "center" && "justify-center",
                  isPinned && "sticky z-20 bg-muted/40 shadow-[1px_0_0_hsl(var(--border))]",
                )}
                style={isPinned ? { left: pinnedOffsets[c.id] } : undefined}
              >
                {isPinned && <Pin className="h-2.5 w-2.5 text-primary shrink-0" />}
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
                {/* Resize handle */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={(e) => onResizeStart(e, c)}
                  onDoubleClick={() =>
                    setState((s) => {
                      const next = { ...(s.colWidths ?? {}) };
                      delete next[c.id];
                      return { ...s, colWidths: next };
                    })
                  }
                  title="Drag to resize. Double-click to auto-reset."
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40"
                />
              </div>
            );
          })}
        </div>

        {/* Body (virtualized) */}
        <div
          ref={parentRef}
          className="relative overflow-auto outline-none"
          style={{ height }}
          tabIndex={0}
          role="grid"
          aria-rowcount={renderRows.length}
          onFocus={() => {
            if (focusedIndex < 0 && renderRows.length > 0) setFocusedIndex(0);
          }}
          onKeyDown={(e) => {
            if (renderRows.length === 0) return;
            const last = renderRows.length - 1;
            const pageSize = Math.max(1, Math.floor(height / rowH) - 1);
            let next = focusedIndex;
            if (e.key === "ArrowDown") next = Math.min(last, (focusedIndex < 0 ? 0 : focusedIndex + 1));
            else if (e.key === "ArrowUp") next = Math.max(0, (focusedIndex < 0 ? 0 : focusedIndex - 1));
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = last;
            else if (e.key === "PageDown") next = Math.min(last, (focusedIndex < 0 ? 0 : focusedIndex) + pageSize);
            else if (e.key === "PageUp") next = Math.max(0, (focusedIndex < 0 ? 0 : focusedIndex) - pageSize);
            else if (e.key === "Enter" || e.key === " ") {
              const cur = renderRows[focusedIndex];
              if (cur?.kind === "group") { toggleGroup(cur.key); e.preventDefault(); return; }
              if (cur?.kind === "row" && onRowClick) { onRowClick(cur.row); e.preventDefault(); return; }
              return;
            } else {
              return;
            }
            e.preventDefault();
            setFocusedIndex(next);
            virtualizer.scrollToIndex(next, { align: "auto" });
          }}
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
                  {visibleColumns.map((c, idx) => {
                    const isPinned = idx < pinnedCount;
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "flex items-center truncate border-r px-2",
                          cellAlign(c) === "right" && "justify-end font-mono tabular-nums",
                          cellAlign(c) === "center" && "justify-center",
                          isPinned && "sticky z-10 bg-card shadow-[1px_0_0_hsl(var(--border))]",
                        )}
                        style={isPinned ? { left: pinnedOffsets[c.id] } : undefined}
                      >
                        <span className="truncate">
                          {c.cell ? c.cell(item.row) : asReact(c.accessor(item.row))}
                        </span>
                      </div>
                    );
                  })}
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
            {visibleColumns.map((c, i) => {
              const isPinned = i < pinnedCount;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "border-r px-2 py-1.5 truncate",
                    cellAlign(c) === "right" && "text-right font-mono tabular-nums",
                    cellAlign(c) === "center" && "text-center",
                    isPinned && "sticky z-10 bg-muted/50 shadow-[1px_0_0_hsl(var(--border))]",
                  )}
                  style={isPinned ? { left: pinnedOffsets[c.id] } : undefined}
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
              );
            })}
          </div>
        )}
      </div>
      )}
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
