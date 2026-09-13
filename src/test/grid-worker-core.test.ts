import { describe, expect, it } from "vitest";
import { processSerializedGrid } from "@/components/data-grid/grid-worker-core";
import { DEFAULT_GRID_STATE } from "@/components/data-grid/types";

describe("serialized grid processing", () => {
  const rows = [
    { __index: 0, __search: "cash receipt", type: "Receipt", debit: 125, credit: 0 },
    { __index: 1, __search: "bank payment", type: "Payment", debit: 0, credit: 75 },
  ];
  const columns = [
    { id: "type", header: "Type", type: "enum" as const, groupable: true },
    { id: "debit", header: "Debit", type: "number" as const, aggregator: "sum" as const },
    { id: "credit", header: "Credit", type: "number" as const, aggregator: "sum" as const },
  ];

  it("rehydrates accessors and returns rows with debit and credit totals", () => {
    const result = processSerializedGrid(rows, columns, DEFAULT_GRID_STATE, []);
    expect(result.visibleCount).toBe(2);
    expect(result.flat).toHaveLength(2);
    expect(result.aggregates).toEqual({ debit: 125, credit: 75 });
    expect(result.enums.type).toEqual(["Payment", "Receipt"]);
  });

  it("keeps global search working after worker serialization", () => {
    const result = processSerializedGrid(
      rows,
      columns,
      { ...DEFAULT_GRID_STATE, search: "bank" },
      [],
    );
    expect(result.visibleCount).toBe(1);
    expect(result.flat[0]).toMatchObject({ kind: "row", row: { __index: 1 } });
  });
});