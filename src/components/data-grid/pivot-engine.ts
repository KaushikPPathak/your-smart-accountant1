// Pure pivot engine. Runs identically on main thread or inside a Web Worker.
// Inputs are JSON-cloneable so the same code path serves both contexts.

import type { Aggregator } from "./types";

export interface PivotValueSpec {
  /** Column id whose numeric value is aggregated */
  id: string;
  agg: Aggregator;
  /** Display label */
  label?: string;
}

export interface PivotConfig {
  rows: string[];
  cols: string[];
  values: PivotValueSpec[];
}

/** Pre-extracted record: a plain map of columnId -> value, built on the main thread. */
export type PivotRecord = Record<string, string | number | null>;

export interface PivotResult {
  /** Hierarchical row paths in display order */
  rowPaths: string[][];
  /** Hierarchical col paths in display order */
  colPaths: string[][];
  /** Value specs (cloned) */
  values: PivotValueSpec[];
  /** matrix[rowIndex][colIndex * values.length + valueIndex] */
  matrix: number[];
  rowsCount: number;
  /** colsCount counts unique col paths (NOT multiplied by values.length) */
  colsCount: number;
  /** Per-row totals, one per value spec: rowTotals[rowIndex * values.length + valueIndex] */
  rowTotals: number[];
  /** Per-col totals: colTotals[colIndex * values.length + valueIndex] */
  colTotals: number[];
  /** Grand totals per value: grandTotals[valueIndex] */
  grandTotals: number[];
  /** True if output was capped */
  capped: boolean;
}

function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function asKey(v: unknown): string {
  return v == null || v === "" ? "(blank)" : String(v);
}

interface Acc {
  sum: number;
  count: number;
  min: number;
  max: number;
  hasNum: boolean;
}
const newAcc = (): Acc => ({ sum: 0, count: 0, min: Infinity, max: -Infinity, hasNum: false });

function pushNum(a: Acc, n: number) {
  a.count++;
  if (Number.isFinite(n)) {
    a.sum += n;
    if (n < a.min) a.min = n;
    if (n > a.max) a.max = n;
    a.hasNum = true;
  }
}
function readAcc(a: Acc, agg: Aggregator): number {
  switch (agg) {
    case "sum": return a.sum;
    case "count": return a.count;
    case "avg": return a.count ? a.sum / a.count : 0;
    case "min": return a.hasNum ? a.min : 0;
    case "max": return a.hasNum ? a.max : 0;
  }
}

export const PIVOT_CELL_CAP = 200_000; // rows * cols * values

export function computePivot(records: PivotRecord[], cfg: PivotConfig): PivotResult {
  const values = cfg.values.length ? cfg.values : [{ id: "__count__", agg: "count" as const, label: "Count" }];

  // 1) Collect unique paths
  const rowMap = new Map<string, string[]>();
  const colMap = new Map<string, string[]>();
  // bucket[rowKey][colKey] = Acc[] per value
  const buckets = new Map<string, Map<string, Acc[]>>();

  for (const rec of records) {
    const rowPath = cfg.rows.length ? cfg.rows.map((id) => asKey(rec[id])) : ["Total"];
    const colPath = cfg.cols.length ? cfg.cols.map((id) => asKey(rec[id])) : ["Total"];
    const rk = rowPath.join("\u0001");
    const ck = colPath.join("\u0001");
    if (!rowMap.has(rk)) rowMap.set(rk, rowPath);
    if (!colMap.has(ck)) colMap.set(ck, colPath);

    let inner = buckets.get(rk);
    if (!inner) { inner = new Map(); buckets.set(rk, inner); }
    let accs = inner.get(ck);
    if (!accs) { accs = values.map(newAcc); inner.set(ck, accs); }
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const raw = v.id === "__count__" ? 1 : asNum(rec[v.id]);
      pushNum(accs[i], v.id === "__count__" ? 1 : raw);
    }
  }

  // 2) Sort paths lexicographically (level by level)
  const sortPaths = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const cmp = (a[i] ?? "").localeCompare(b[i] ?? "", undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
  const rowPaths = [...rowMap.values()].sort(sortPaths);
  const colPaths = [...colMap.values()].sort(sortPaths);

  const R = rowPaths.length;
  const C = colPaths.length;
  const V = values.length;
  const capped = R * C * V > PIVOT_CELL_CAP;

  // Honour the cap by truncating the largest axis
  let rowsUsed = R, colsUsed = C;
  if (capped) {
    // shrink columns first (usually fewer), else rows
    const maxCols = Math.max(1, Math.floor(PIVOT_CELL_CAP / Math.max(1, R * V)));
    if (maxCols < C) colsUsed = maxCols;
    else {
      const maxRows = Math.max(1, Math.floor(PIVOT_CELL_CAP / Math.max(1, C * V)));
      rowsUsed = maxRows;
    }
  }
  const rowPathsOut = rowPaths.slice(0, rowsUsed);
  const colPathsOut = colPaths.slice(0, colsUsed);
  const colKeyIndex = new Map(colPathsOut.map((p, i) => [p.join("\u0001"), i]));

  // 3) Build matrices
  const matrix = new Array<number>(rowsUsed * colsUsed * V).fill(0);
  const rowTotalsAcc: Acc[] = Array.from({ length: rowsUsed * V }, newAcc);
  const colTotalsAcc: Acc[] = Array.from({ length: colsUsed * V }, newAcc);
  const grandAcc: Acc[] = Array.from({ length: V }, newAcc);

  for (let r = 0; r < rowsUsed; r++) {
    const rk = rowPathsOut[r].join("\u0001");
    const inner = buckets.get(rk);
    if (!inner) continue;
    for (const [ck, accs] of inner.entries()) {
      const c = colKeyIndex.get(ck);
      if (c == null) continue;
      for (let v = 0; v < V; v++) {
        const val = readAcc(accs[v], values[v].agg);
        matrix[(r * colsUsed + c) * V + v] = val;
        // For totals, we re-aggregate on stored sums/counts to keep avg correct
        const a = accs[v];
        rowTotalsAcc[r * V + v].sum += a.sum;
        rowTotalsAcc[r * V + v].count += a.count;
        rowTotalsAcc[r * V + v].hasNum ||= a.hasNum;
        if (a.hasNum) {
          if (a.min < rowTotalsAcc[r * V + v].min) rowTotalsAcc[r * V + v].min = a.min;
          if (a.max > rowTotalsAcc[r * V + v].max) rowTotalsAcc[r * V + v].max = a.max;
        }
        colTotalsAcc[c * V + v].sum += a.sum;
        colTotalsAcc[c * V + v].count += a.count;
        colTotalsAcc[c * V + v].hasNum ||= a.hasNum;
        if (a.hasNum) {
          if (a.min < colTotalsAcc[c * V + v].min) colTotalsAcc[c * V + v].min = a.min;
          if (a.max > colTotalsAcc[c * V + v].max) colTotalsAcc[c * V + v].max = a.max;
        }
        grandAcc[v].sum += a.sum;
        grandAcc[v].count += a.count;
        grandAcc[v].hasNum ||= a.hasNum;
        if (a.hasNum) {
          if (a.min < grandAcc[v].min) grandAcc[v].min = a.min;
          if (a.max > grandAcc[v].max) grandAcc[v].max = a.max;
        }
      }
    }
  }

  const rowTotals = rowTotalsAcc.map((a, i) => readAcc(a, values[i % V].agg));
  const colTotals = colTotalsAcc.map((a, i) => readAcc(a, values[i % V].agg));
  const grandTotals = grandAcc.map((a, v) => readAcc(a, values[v].agg));

  return {
    rowPaths: rowPathsOut,
    colPaths: colPathsOut,
    values,
    matrix,
    rowsCount: rowsUsed,
    colsCount: colsUsed,
    rowTotals,
    colTotals,
    grandTotals,
    capped,
  };
}
