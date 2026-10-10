import { describe, expect, it } from "vitest";

import {
  createGstr9InputId,
  emptyTaxAmount,
  type Gstr9InputRecord,
} from "./gstr9-inputs";
import {
  deleteGstr9InputRecord,
  fromGstr9InputCacheRow,
  loadGstr9InputRecord,
  saveGstr9InputRecord,
  toGstr9InputCacheRow,
  type Gstr9InputCacheRow,
} from "./gstr9-input-store";

function makeRecord(
  companyId: string,
  financialYear: string,
): Gstr9InputRecord {
  return {
    id: createGstr9InputId(companyId, financialYear),
    companyId,
    financialYear,
    gstr1: {
      table4: {
        b2b: { ...emptyTaxAmount(), taxableValue: 1000 },
        b2cLarge: emptyTaxAmount(),
        exportsWithPayment: emptyTaxAmount(),
        sezWithPayment: emptyTaxAmount(),
        deemedExports: emptyTaxAmount(),
        advancesTaxPaid: emptyTaxAmount(),
        inwardSuppliesRcm: emptyTaxAmount(),
        b2cOther: emptyTaxAmount(),
        exportsWithoutPayment: emptyTaxAmount(),
        sezWithoutPayment: emptyTaxAmount(),
        advancesTaxAdjusted: emptyTaxAmount(),
        otherOutwardTaxableSupplies: emptyTaxAmount(),
        total: { ...emptyTaxAmount(), taxableValue: 1000 },
      },
      table5: {
        exportsWithoutPayment: emptyTaxAmount(),
        sezWithoutPayment: emptyTaxAmount(),
        suppliesOnWhichTaxPayableByRecipient: emptyTaxAmount(),
        exemptSupplies: emptyTaxAmount(),
        nilRatedSupplies: emptyTaxAmount(),
        nonGstSupplies: emptyTaxAmount(),
        total: emptyTaxAmount(),
      },
      metadata: {
        source: "MANUAL",
        enteredAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
      },
    },
  };
}

function makeFakeTable() {
  const rows = new Map<string, Gstr9InputCacheRow>();

  return {
    async put(row: Gstr9InputCacheRow) {
      rows.set(row.id, row);
    },
    async get(id: string) {
      return rows.get(id);
    },
    async delete(id: string) {
      rows.delete(id);
    },
    size() {
      return rows.size;
    },
  };
}

describe("gstr9-input-store", () => {
  it("maps a record to a company/FY-scoped cache row", () => {
    const record = makeRecord("company-a", "2025-26");
    const row = toGstr9InputCacheRow(
      record,
      "2026-09-26T10:00:00.000Z",
    );

    expect(row.id).toBe("company-a:2025-26");
    expect(row.company_id).toBe("company-a");
    expect(row.financial_year).toBe("2025-26");
    expect(row.updated_at).toBe("2026-09-26T10:00:00.000Z");
    expect(row.payload).toEqual(record);
  });

  it("round-trips the stored payload without changing it", () => {
    const record = makeRecord("company-a", "2025-26");
    const row = toGstr9InputCacheRow(record);

    expect(fromGstr9InputCacheRow(row)).toEqual(record);
    expect(fromGstr9InputCacheRow(undefined)).toBeUndefined();
  });

  it("saves and reloads the same company and FY", async () => {
    const table = makeFakeTable();
    const record = makeRecord("company-a", "2025-26");

    await saveGstr9InputRecord(record, table);

    await expect(
      loadGstr9InputRecord("company-a", "2025-26", table),
    ).resolves.toEqual(record);
    expect(table.size()).toBe(1);
  });

  it("keeps companies isolated", async () => {
    const table = makeFakeTable();
    const a = makeRecord("company-a", "2025-26");
    const b = makeRecord("company-b", "2025-26");

    await saveGstr9InputRecord(a, table);
    await saveGstr9InputRecord(b, table);

    await expect(
      loadGstr9InputRecord("company-a", "2025-26", table),
    ).resolves.toEqual(a);
    await expect(
      loadGstr9InputRecord("company-b", "2025-26", table),
    ).resolves.toEqual(b);
    expect(table.size()).toBe(2);
  });

  it("keeps financial years isolated", async () => {
    const table = makeFakeTable();
    const current = makeRecord("company-a", "2025-26");
    const next = makeRecord("company-a", "2026-27");

    await saveGstr9InputRecord(current, table);
    await saveGstr9InputRecord(next, table);

    await expect(
      loadGstr9InputRecord("company-a", "2025-26", table),
    ).resolves.toEqual(current);
    await expect(
      loadGstr9InputRecord("company-a", "2026-27", table),
    ).resolves.toEqual(next);
    expect(table.size()).toBe(2);
  });

  it("replaces only the same company/FY record", async () => {
    const table = makeFakeTable();
    const first = makeRecord("company-a", "2025-26");
    const replacement = makeRecord("company-a", "2025-26");
    replacement.gstr1!.table4.b2b.taxableValue = 2500;

    await saveGstr9InputRecord(first, table);
    await saveGstr9InputRecord(replacement, table);

    await expect(
      loadGstr9InputRecord("company-a", "2025-26", table),
    ).resolves.toEqual(replacement);
    expect(table.size()).toBe(1);
  });

  it("deletes only the requested company/FY record", async () => {
    const table = makeFakeTable();
    const a = makeRecord("company-a", "2025-26");
    const b = makeRecord("company-a", "2026-27");

    await saveGstr9InputRecord(a, table);
    await saveGstr9InputRecord(b, table);

    await deleteGstr9InputRecord("company-a", "2025-26", table);

    await expect(
      loadGstr9InputRecord("company-a", "2025-26", table),
    ).resolves.toBeUndefined();
    await expect(
      loadGstr9InputRecord("company-a", "2026-27", table),
    ).resolves.toEqual(b);
  });
});
