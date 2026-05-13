import type { ReactNode } from "react";

export type ColType = "text" | "number" | "date" | "enum";

export type Aggregator = "sum" | "count" | "avg" | "min" | "max";

export interface DGColumn<T> {
  /** Stable id used for sort/filter/group keys and persistence */
  id: string;
  /** Header label */
  header: ReactNode;
  /** Value accessor — return the raw underlying value (number/date string/string) */
  accessor: (row: T) => unknown;
  /** Optional render override for cells */
  cell?: (row: T) => ReactNode;
  /** Logical type. Drives default filter, sort and alignment */
  type?: ColType;
  /** Initial width in px */
  width?: number;
  /** Min width in px */
  minWidth?: number;
  /** Hide by default */
  hidden?: boolean;
  /** Allowed enum values (used by enum filter). If omitted, derived from data. */
  enumValues?: string[];
  /** Right-align (default true for number) */
  align?: "left" | "right" | "center";
  /** Whether this column participates in footer aggregation */
  aggregator?: Aggregator;
  /** Optional renderer for the footer aggregate value */
  formatAggregate?: (value: number) => ReactNode;
  /** When grouped, render the group's subtotal cell */
  formatGroupValue?: (value: number) => ReactNode;
  /** Allow group-by on this column */
  groupable?: boolean;
}

export type SortDir = "asc" | "desc";
export interface SortRule { id: string; dir: SortDir }

export type FilterOp =
  // text
  | "contains" | "equals" | "startsWith" | "regex" | "blank" | "notBlank"
  // number
  | "eq" | "neq" | "gt" | "lt" | "between"
  // date
  | "on" | "before" | "after" | "dateBetween"
  // enum
  | "in";

export interface ColumnFilter {
  id: string;
  op: FilterOp;
  /** Single value, range tuple, or array (for `in`) */
  value: unknown;
}

export interface GridState {
  sort: SortRule[];
  filters: ColumnFilter[];
  groupBy: string[];
  hiddenCols: string[];
  density: "comfortable" | "compact";
  search: string;
}

export const DEFAULT_GRID_STATE: GridState = {
  sort: [],
  filters: [],
  groupBy: [],
  hiddenCols: [],
  density: "comfortable",
  search: "",
};

export interface SavedView {
  name: string;
  state: GridState;
}
