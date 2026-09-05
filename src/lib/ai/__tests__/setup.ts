import { offlineDb } from "@/lib/offline/db";

export const TEST_COMPANY_ID = "test-company-123";

export async function setupTestFixtures() {
  try {
    await offlineDb.companies.put({
      id: TEST_COMPANY_ID,
      name: "Test Company",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state: "24",
      financial_year_start: "2026-04-01",
      books_begin_date: "2026-04-01",
    });
  } catch (error) {
    console.error("Failed to setup test fixtures:", error);
  }
}

export async function teardownTestFixtures() {
  try {
    await offlineDb.companies.delete(TEST_COMPANY_ID);
  } catch (error) {
    console.error("Failed to teardown test fixtures:", error);
  }
}
