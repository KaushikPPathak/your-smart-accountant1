import { test as setup, type Page } from '@playwright/test';

async function prepareDesktopRuntime(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    localStorage.setItem('ym_local_profile_ready', '1');
    localStorage.setItem('ym_data_ownership_ack_v1', '1');
    sessionStorage.setItem('ym_unlocked', '1');
  });
}

async function seedCompanies(page: Page, companies: Array<{ id: string; name: string }>) {
  await page.evaluate(async (rows) => {
    const loadDb = new Function("return import('/src/lib/offline/db.ts')") as () => Promise<{
      offlineDb: {
        open: () => Promise<void>;
        companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
        cache_companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
      };
    }>;
    const { offlineDb } = await loadDb();
    await offlineDb.open();
    await Promise.all([
      offlineDb.companies.bulkPut(rows),
      offlineDb.cache_companies.bulkPut(
        rows.map((row) => ({
          ...row,
          company_id: row.id,
          has_password: false,
          updated_at: new Date().toISOString(),
        })),
      ),
    ]);
  }, companies);
}

/**
 * Honest cold-start of the real workspace: seed IndexedDB, click the picker
 * tile once (mouse is allowed for setup), then RELOAD so focus starts on
 * document.body — no residual click focus, no programmatic .focus() masking.
 *
 * After this returns, the calling test must drive everything via
 * page.keyboard.press() only.
 */
export async function setupRealWorkspace(page: Page) {
  await prepareDesktopRuntime(page);
  await page.goto('/');
  await seedCompanies(page, [
    { id: 'test-company-123', name: 'Test Business Corp' },
    { id: 'test-company-456', name: 'Second Business Corp' },
  ]);
  await page.evaluate(() => {
    localStorage.setItem('ym_active_company_id', 'test-company-123');
    localStorage.setItem('ym_quickribbon_open', '1');
    sessionStorage.setItem('ym_unlocked_test-company-123', '1');
  });
  await page.goto('/app');
  const pickerTile = page.getByRole('button', { name: /Test Business Corp/i });
  if (await pickerTile.isVisible().catch(() => false)) {
    await pickerTile.click();
  }
  await page.waitForSelector('nav[aria-label="Primary menus"]');
  // Reload to reach honest cold-start focus state (body, nothing focused).
  await page.reload();
  await page.waitForSelector('nav[aria-label="Primary menus"]');
}

export async function setupCompanyPicker(page: Page) {
  await prepareDesktopRuntime(page);
  await page.goto('/');
  await seedCompanies(page, [
    { id: 'company-1', name: 'Alpha Traders' },
    { id: 'company-2', name: 'Beta Stores' },
    { id: 'company-3', name: 'Cedar & Co' },
    { id: 'company-4', name: 'Delta Services' },
    { id: 'company-5', name: 'Evergreen Supply' },
  ]);
  await page.reload();
  await page.waitForSelector('[data-company-index="0"]');
}
