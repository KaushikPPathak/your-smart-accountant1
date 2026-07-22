// Non-destructive setup / teardown for the AI test harness.
// Writes mock rows into the offline IndexedDB tables under TEST_COMPANY_ID
// and removes them again on teardown. Never touches real company data.

import { offlineDb } from "@/lib/offline/db";
import { invalidateAnswerCache } from "@/lib/ai/answer-cache";
import { invalidateSemanticIndex } from "@/lib/ai/semantic-index";
import {
  MOCK_LEDGERS,
  MOCK_ITEMS,
  MOCK_VOUCHERS,
  MOCK_VOUCHER_ENTRIES,
  TEST_COMPANY_ID,
} from "./mocks/mock-data";

type AnyTable = { bulkPut: (rows: unknown[]) => Promise<unknown>; where: (k: string) => { equals: (v: unknown) => { delete: () => Promise<unknown> } } };

function table(name: string): AnyTable | null {
  const t = (offlineDb as unknown as Record<string, AnyTable | undefined>)[name];
  return t ?? null;
}

async function safeBulkPut(name: string, rows: unknown[]) {
  const t = table(name);
  if (!t) return;
  try { await t.bulkPut(rows); } catch { /* schema drift — ignore, harness tests will surface it */ }
}

async function safeDelete(name: string, companyId: string) {
  const t = table(name);
  if (!t) return;
  try { await t.where("company_id").equals(companyId).delete(); } catch { /* ignore */ }
}

export async function setupTestFixtures(): Promise<void> {
  await safeBulkPut("ledgers_cache", MOCK_LEDGERS);
  await safeBulkPut("items_cache", MOCK_ITEMS);
  await safeBulkPut("vouchers_cache", MOCK_VOUCHERS);
  await safeBulkPut("voucher_entries_cache", MOCK_VOUCHER_ENTRIES);
}

export async function teardownTestFixtures(): Promise<void> {
  for (const n of ["ledgers_cache", "items_cache", "vouchers_cache", "voucher_entries_cache", "voucher_items_cache"]) {
    await safeDelete(n, TEST_COMPANY_ID);
  }
  invalidateAnswerCache(TEST_COMPANY_ID);
  invalidateSemanticIndex(TEST_COMPANY_ID);
}

export { TEST_COMPANY_ID };
