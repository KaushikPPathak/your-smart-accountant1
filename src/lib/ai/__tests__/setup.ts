// Writes the non-destructive mock books for the AI harness and removes them
// afterwards. Every row uses TEST_COMPANY_ID, so real company data is untouched.
import { offlineDb } from "@/lib/offline/db";
import {
  TEST_COMPANY_ID,
  MOCK_LEDGERS,
  MOCK_ITEMS,
  MOCK_VOUCHERS,
  MOCK_VOUCHER_ENTRIES,
} from "./mocks/mock-data";
import { invalidateSemanticIndex } from "@/lib/ai/semantic-index";

export { TEST_COMPANY_ID };

const NOW = () => new Date().toISOString();

export async function setupTestFixtures() {
  await offlineDb.cache_companies.put({
    id: TEST_COMPANY_ID, name: "AI Test Company", state_code: "24",
    financial_year_start: "2026-04-01", books_begin_date: "2026-04-01", updated_at: NOW(),
  });
  await offlineDb.cache_ledgers.bulkPut(MOCK_LEDGERS);
  await offlineDb.cache_items.bulkPut(MOCK_ITEMS);
  await offlineDb.cache_vouchers.bulkPut(MOCK_VOUCHERS);
  await offlineDb.cache_voucher_entries.bulkPut(MOCK_VOUCHER_ENTRIES);
  try { invalidateSemanticIndex(TEST_COMPANY_ID); } catch { /* index rebuilds lazily */ }
}

export async function teardownTestFixtures() {
  try {
    await offlineDb.cache_voucher_entries.bulkDelete(MOCK_VOUCHER_ENTRIES.map((r) => r.id));
    await offlineDb.cache_vouchers.bulkDelete(MOCK_VOUCHERS.map((r) => r.id));
    await offlineDb.cache_items.bulkDelete(MOCK_ITEMS.map((r) => r.id));
    await offlineDb.cache_ledgers.bulkDelete(MOCK_LEDGERS.map((r) => r.id));
    await offlineDb.cache_companies.delete(TEST_COMPANY_ID);
    try { invalidateSemanticIndex(TEST_COMPANY_ID); } catch { /* ignore */ }
  } catch (error) {
    console.error("Failed to teardown test fixtures:", error);
  }
}
