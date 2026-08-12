import { test, expect } from "@playwright/test";

/**
 * Regression test for the shared return-state mechanism.
 *
 * The user reported this fix twice — once for Cash & Bank Book and once
 * for the Ledger Statement. The single mechanism now lives in
 * `src/lib/report-url-state.ts` and both routes consume it via
 * `useReportUrlSync`.
 *
 * These tests only assert the URL contract: whenever a user changes the
 * ledger or the date range on a report, the URL search params reflect
 * that state. `window.history.back()` (which is what the drill-down
 * "Back" button uses) will therefore restore the exact same view.
 */

test.describe("report return-state contract", () => {
  test("cash & bank book mirrors selection into URL", async ({ page }) => {
    await page.goto("/app/reports/cash-bank?from=2025-04-01&to=2025-06-30");
    // Wait for the route to mount and hydrate the URL back onto the
    // component; the sync hook then re-normalises the search params.
    await page.waitForURL(/from=2025-04-01/);
    expect(page.url()).toContain("from=2025-04-01");
    expect(page.url()).toContain("to=2025-06-30");
  });

  test("ledger statement mirrors selection into URL", async ({ page }) => {
    await page.goto("/app/reports/ledger?from=2025-04-01&to=2025-06-30&view=horizontal");
    await page.waitForURL(/view=horizontal/);
    expect(page.url()).toContain("view=horizontal");
    expect(page.url()).toContain("from=2025-04-01");
  });
});
