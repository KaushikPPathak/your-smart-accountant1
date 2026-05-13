import type { ColumnFilter, DGColumn, GridState, SortRule } from "./types";

function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v);
}
function asDate(v: unknown): number {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  const s = String(v);
  // Treat "YYYY-MM-DD" as date only
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function passFilter<T>(row: T, col: DGColumn<T>, f: ColumnFilter): boolean {
  const raw = col.accessor(row);
  switch (f.op) {
    case "blank": return raw == null || raw === "";
    case "notBlank": return !(raw == null || raw === "");
    case "contains": return asStr(raw).toLowerCase().includes(asStr(f.value).toLowerCase());
    case "equals": return asStr(raw).toLowerCase() === asStr(f.value).toLowerCase();
    case "startsWith": return asStr(raw).toLowerCase().startsWith(asStr(f.value).toLowerCase());
    case "regex": {
      try { return new RegExp(asStr(f.value), "i").test(asStr(raw)); }
      catch { return false; }
    }
    case "eq": return asNum(raw) === asNum(f.value);
    case "neq": return asNum(raw) !== asNum(f.value);
    case "gt": return asNum(raw) > asNum(f.value);
    case "lt": return asNum(raw) < asNum(f.value);
    case "between": {
      const [a, b] = (f.value as [unknown, unknown]) ?? [NaN, NaN];
      const n = asNum(raw);
      return n >= asNum(a) && n <= asNum(b);
    }
    case "on": return asStr(raw) === asStr(f.value);
    case "before": return asDate(raw) < asDate(f.value);
    case "after": return asDate(raw) > asDate(f.value);
    case "dateBetween": {
      const [a, b] = (f.value as [unknown, unknown]) ?? [null, null];
      const n = asDate(raw);
      return n >= asDate(a) && n <= asDate(b);
    }
    case "in": {
      const arr = Array.isArray(f.value) ? f.value as unknown[] : [];
      if (arr.length === 0) return true;
      return arr.includes(raw as never) || arr.map(asStr).includes(asStr(raw));
    }
  }
}

function compare<T>(a: T, b: T, col: DGColumn<T>, dir: "asc" | "desc"): number {
  const av = col.accessor(a);
  const bv = col.accessor(b);
  const t = col.type ?? "text";
  let cmp = 0;
  if (t === "number") cmp = (asNum(av) || 0) - (asNum(bv) || 0);
  else if (t === "date") cmp = (asDate(av) || 0) - (asDate(bv) || 0);
  else cmp = asStr(av).localeCompare(asStr(bv), undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

export interface ProcessedRow<T> {
  kind: "row";
  row: T;
  index: number;
}
export interface GroupRow<T> {
  kind: "group";
  key: string;
  groupCol: string;
  level: number;
  count: number;
  expanded: boolean;
  aggregates: Record<string, number>;
  /** Hidden when a parent group is collapsed */
  visible: boolean;
  children: Array<ProcessedRow<T> | GroupRow<T>>;
}

export type FlatRow<T> = ProcessedRow<T> | GroupRow<T>;

export function processRows<T>(
  rows: T[],
  columns: DGColumn<T>[],
  state: GridState,
  expandedGroups: Set<string>,
  globalSearchAccessor?: (row: T) => string,
): { flat: FlatRow<T>[]; aggregates: Record<string, number>; visibleCount: number } {
  const colsById = new Map(columns.map((c) => [c.id, c]));

  // 1. Filter
  let working = rows;
  if (state.filters.length || state.search) {
    const q = state.search.trim().toLowerCase();
    working = rows.filter((r) => {
      for (const f of state.filters) {
        const c = colsById.get(f.id);
        if (!c) continue;
        if (!passFilter(r, c, f)) return false;
      }
      if (q && globalSearchAccessor) {
        if (!globalSearchAccessor(r).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  // 2. Sort (multi-key)
  if (state.sort.length) {
    const rules = state.sort
      .map((s) => ({ s, c: colsById.get(s.id) }))
      .filter((x) => x.c) as { s: SortRule; c: DGColumn<T> }[];
    working = [...working].sort((a, b) => {
      for (const { s, c } of rules) {
        const cmp = compare(a, b, c, s.dir);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  // 3. Aggregate (overall footer)
  const aggregates = computeAggregates(working, columns);

  // 4. Group
  if (state.groupBy.length === 0) {
    return {
      flat: working.map((row, index) => ({ kind: "row", row, index })),
      aggregates,
      visibleCount: working.length,
    };
  }

  const flat: FlatRow<T>[] = [];
  const buildLevel = (
    items: T[],
    level: number,
    parentExpanded: boolean,
    parentKey: string,
  ) => {
    const groupColId = state.groupBy[level];
    const groupCol = colsById.get(groupColId);
    if (!groupCol) return;
    const buckets = new Map<string, T[]>();
    for (const r of items) {
      const k = asStr(groupCol.accessor(r));
      const arr = buckets.get(k);
      if (arr) arr.push(r); else buckets.set(k, [r]);
    }
    const keys = [...buckets.keys()].sort();
    for (const k of keys) {
      const groupKey = `${parentKey}/${groupColId}=${k}`;
      const children = buckets.get(k)!;
      const expanded = expandedGroups.has(groupKey);
      const aggs = computeAggregates(children, columns);
      const groupRow: GroupRow<T> = {
        kind: "group",
        key: groupKey,
        groupCol: groupColId,
        level,
        count: children.length,
        expanded,
        aggregates: aggs,
        visible: parentExpanded,
        children: [],
      };
      flat.push(groupRow);
      if (expanded) {
        if (level + 1 < state.groupBy.length) {
          buildLevel(children, level + 1, true, groupKey);
        } else {
          children.forEach((row, i) => flat.push({ kind: "row", row, index: i }));
        }
      }
    }
  };
  buildLevel(working, 0, true, "");
  return { flat, aggregates, visibleCount: working.length };
}

export function computeAggregates<T>(rows: T[], columns: DGColumn<T>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of columns) {
    if (!c.aggregator) continue;
    if (c.aggregator === "count") { out[c.id] = rows.length; continue; }
    let sum = 0, n = 0, mn = Infinity, mx = -Infinity;
    for (const r of rows) {
      const v = asNum(c.accessor(r));
      if (!Number.isFinite(v)) continue;
      sum += v; n++;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (c.aggregator === "sum") out[c.id] = sum;
    else if (c.aggregator === "avg") out[c.id] = n ? sum / n : 0;
    else if (c.aggregator === "min") out[c.id] = n ? mn : 0;
    else if (c.aggregator === "max") out[c.id] = n ? mx : 0;
  }
  return out;
}

export function deriveEnumValues<T>(rows: T[], col: DGColumn<T>): string[] {
  if (col.enumValues) return col.enumValues;
  const set = new Set<string>();
  for (const r of rows) {
    const v = col.accessor(r);
    if (v != null && v !== "") set.add(asStr(v));
    if (set.size > 200) break;
  }
  return [...set].sort();
}
