import type { Table } from "dexie";

import {
  createGstr9InputId,
  type Gstr9InputRecord,
} from "./gstr9-inputs";
import { offlineDb } from "./offline/db";

export interface Gstr9InputCacheRow {
  id: string;
  company_id: string;
  financial_year: string;
  updated_at: string;
  payload: Gstr9InputRecord;
}

type Gstr9InputTable = Pick<
  Table<Gstr9InputCacheRow, string>,
  "get" | "put" | "delete"
>;

export function toGstr9InputCacheRow(
  record: Gstr9InputRecord,
  updatedAt = new Date().toISOString(),
): Gstr9InputCacheRow {
  return {
    id: createGstr9InputId(record.companyId, record.financialYear),
    company_id: record.companyId,
    financial_year: record.financialYear,
    updated_at: updatedAt,
    payload: record,
  };
}

export function fromGstr9InputCacheRow(
  row: Gstr9InputCacheRow | undefined,
): Gstr9InputRecord | undefined {
  return row?.payload;
}

export async function saveGstr9InputRecord(
  record: Gstr9InputRecord,
  table: Gstr9InputTable = offlineDb.cache_gstr9_inputs,
): Promise<void> {
  await table.put(toGstr9InputCacheRow(record));
}

export async function loadGstr9InputRecord(
  companyId: string,
  financialYear: string,
  table: Gstr9InputTable = offlineDb.cache_gstr9_inputs,
): Promise<Gstr9InputRecord | undefined> {
  const row = await table.get(
    createGstr9InputId(companyId, financialYear),
  );

  return fromGstr9InputCacheRow(row);
}

export async function deleteGstr9InputRecord(
  companyId: string,
  financialYear: string,
  table: Gstr9InputTable = offlineDb.cache_gstr9_inputs,
): Promise<void> {
  await table.delete(
    createGstr9InputId(companyId, financialYear),
  );
}
