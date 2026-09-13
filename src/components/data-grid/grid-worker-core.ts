import { deriveEnumValues, processRows } from "./grid-engine";
import type { DGColumn, GridState } from "./types";

export interface SerializedGridColumn {
  id: string;
  header: string;
  type?: DGColumn<unknown>["type"];
  aggregator?: DGColumn<unknown>["aggregator"];
  groupable?: boolean;
  enumValues?: string[];
}

export interface SerializedGridRow {
  __index: number;
  __search?: string;
  [columnId: string]: unknown;
}

/** Rebuild accessors after column functions have been stripped for postMessage. */
export function processSerializedGrid(
  rows: SerializedGridRow[],
  serializedColumns: SerializedGridColumn[],
  state: GridState,
  expandedGroups: string[],
) {
  const columns: DGColumn<SerializedGridRow>[] = serializedColumns.map((column) => ({
    ...column,
    accessor: (row) => row[column.id],
  }));
  const result = processRows(
    rows,
    columns,
    state,
    new Set(expandedGroups),
    (row) => row.__search ?? "",
  );
  const enums: Record<string, string[]> = {};
  for (const column of columns) {
    if (column.type === "enum") enums[column.id] = deriveEnumValues(rows, column);
  }
  return { ...result, enums };
}