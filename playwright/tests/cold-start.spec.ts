import { test, expect, type Page } from '@playwright/test';

/**
 * Cold-start keyboard test.
 *
 * Strict rules for this file:
 *   - No page.focus() calls.
 *   - No element.focus() calls (neither in Playwright locators nor via
 *     page.evaluate).
 *   - The only inputs are page.goto() and page.keyboard.press().
 *
 * The path exercised is the real one a user hits after launching the app:
 * the menubar must be reachable with a single Tab, arrow keys must move
 * between top menus AND open the target menu without pressing Enter, and
 * Enter must confirm-open the currently focused menu.
 */

async function bootWorkspace(page: Page) {
  // Seed the desktop-runtime flags BEFORE the first navigation so the shell
  // skips the lock/onboarding gates. No focus() calls anywhere.
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    localStorage.setItem('ym_local_profile_ready', '1');
    localStorage.setItem('ym_data_ownership_ack_v1', '1');
    localStorage.setItem('ym_active_company_id', 'cold-start-co');
    localStorage.setItem('ym_quickribbon_open', '1');
    sessionStorage.setItem('ym_unlocked', '1');
    sessionStorage.setItem('ym_unlocked_cold-start-co', '1');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const loadDb = new Function("return import('/src/lib/offline/db.ts')") as () => Promise<{
      offlineDb: {
        open: () => Promise<void>;
        companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
        cache_companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
      };
    }>;
    const { offlineDb } = await loadDb();
    await offlineDb.open();
    const row = { id: 'cold-start-co', name: 'Cold Start Co' };
    await offlineDb.companies.bulkPut([row]);
    await offlineDb.cache_companies.bulkPut([
      { ...row, company_id: row.id, has_password: false, updated_at: new Date().toISOString() },
    ]);
  });
  await page.goto('/app');
  await page.waitForSelector('nav[aria-label="Primary menus"]');
}

test.describe('Cold-start keyboard path (no programmatic focus)', () => {
  test('Tab → Right → Enter opens the Transactions dropdown', async ({ page }) => {
    await bootWorkspace(page);

    // Single Tab must land on the File (brand) trigger.
    await page.keyboard.press('Tab');
    await expect(page.locator('button[data-menu-key="file"]')).toBeFocused();

    // Right once → Masters trigger focused AND its dropdown opens automatically
    // (single-owner focus-in handler in TopMenuBar).
    await page.keyboard.press('ArrowRight');
    const masters = page.locator('button[data-menu-key="masters"]');
    await expect(masters).toBeFocused();
    await expect(masters).toHaveAttribute('aria-expanded', 'true');

    // Right again → Transactions trigger focused AND its dropdown open.
    await page.keyboard.press('ArrowRight');
    const transactions = page.locator('button[data-menu-key="transactions"]');
    await expect(transactions).toBeFocused();
    await expect(transactions).toHaveAttribute('aria-expanded', 'true');

    // Transaction dropdown must be visible (contains "All Vouchers").
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();

    // Enter should also work (Radix owns Enter on the trigger); pressing it
    // when the menu is already open is a no-op — the menu stays visible.
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();
  });

  test('arrow alone (no Enter) opens each top menu in turn', async ({ page }) => {
    await bootWorkspace(page);

    await page.keyboard.press('Tab');
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    expect(keys[0]).toBe('file');

    for (let i = 1; i < keys.length; i++) {
      await page.keyboard.press('ArrowRight');
      const trigger = page.locator(`button[data-menu-key="${keys[i]}"]`);
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }
  });
});
