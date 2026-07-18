import { test, expect, type Page } from '@playwright/test';

/**
 * Cold-start keyboard test — single event owner verification.
 *
 * Setup (uses mouse click on the company picker, which is allowed) primes
 * IndexedDB with a test company, opens it via the picker, then RELOADS the
 * page. After the reload, focus is on document.body and no dropdown is open
 * — the honest cold-start state.
 *
 * The test body then uses ONLY page.keyboard.press():
 *   - No page.focus()
 *   - No element.focus()
 *   - No page.evaluate('...focus()...')
 *
 * What we're verifying:
 *   1. A single Tab lands on the File menu trigger.
 *   2. ArrowRight moves focus AND opens the next menu's dropdown, no Enter
 *      required (this is the specific bug the user reported).
 *   3. Enter on an already-open trigger keeps the menu visible (Radix owns
 *      this — proves we haven't broken Radix's built-in behaviour).
 */

async function bootColdStart(page: Page) {
  // Tauri shim + local-profile flags — this app refuses to render the
  // workspace in a plain browser context.
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    localStorage.setItem('ym_local_profile_ready', '1');
    localStorage.setItem('ym_data_ownership_ack_v1', '1');
    sessionStorage.setItem('ym_unlocked', '1');
  });

  await page.goto('/');
  await page.evaluate(async () => {
    const load = new Function("return import('/src/lib/offline/db.ts')") as () => Promise<{
      offlineDb: {
        open: () => Promise<void>;
        companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
        cache_companies: { bulkPut: (values: unknown[]) => Promise<unknown> };
      };
    }>;
    const { offlineDb } = await load();
    await offlineDb.open();
    const row = { id: 'cold-start-co', name: 'Cold Start Co' };
    await offlineDb.companies.bulkPut([row]);
    await offlineDb.cache_companies.bulkPut([
      { ...row, company_id: row.id, has_password: false, updated_at: new Date().toISOString() },
    ]);
    localStorage.setItem('ym_active_company_id', 'cold-start-co');
    localStorage.setItem('ym_quickribbon_open', '1');
    sessionStorage.setItem('ym_unlocked_cold-start-co', '1');
  });

  await page.goto('/app');
  // Router uses hash routing; picker renders first. Click it (mouse is
  // allowed) to unlock the workspace, then reload for a clean focus state.
  const tile = page.getByRole('button', { name: /Cold Start Co/i });
  await tile.waitFor({ state: 'visible' });
  await tile.click();
  await page.waitForSelector('nav[aria-label="Primary menus"]');
  await page.reload();
  await page.waitForSelector('nav[aria-label="Primary menus"]');
  // Sanity: after reload, nothing should be focused yet (true cold start).
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  expect(activeTag).toBe('BODY');
}

test.describe('Cold-start keyboard path (no programmatic focus in test body)', () => {
  test('Tab → Right → Right → Enter reaches the Transactions dropdown', async ({ page }) => {
    await bootColdStart(page);

    // Single Tab must land on the File (brand) trigger.
    await page.keyboard.press('Tab');
    await expect(page.locator('button[data-menu-key="file"]')).toBeFocused();

    // ArrowRight → Masters focused AND its dropdown opens on focus alone.
    await page.keyboard.press('ArrowRight');
    const masters = page.locator('button[data-menu-key="masters"]');
    await expect(masters).toBeFocused();
    await expect(masters).toHaveAttribute('aria-expanded', 'true');

    // ArrowRight → Transactions focused AND dropdown open (still no Enter).
    await page.keyboard.press('ArrowRight');
    const transactions = page.locator('button[data-menu-key="transactions"]');
    await expect(transactions).toBeFocused();
    await expect(transactions).toHaveAttribute('aria-expanded', 'true');

    // The Transactions dropdown must be visible.
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();

    // Enter on an already-open trigger keeps the menu visible.
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();
  });

  test('arrow alone (no Enter) opens every top menu in sequence', async ({ page }) => {
    await bootColdStart(page);
    await page.keyboard.press('Tab');

    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    expect(keys[0]).toBe('file');
    expect(keys.length).toBeGreaterThan(2);

    for (let i = 1; i < keys.length; i++) {
      await page.keyboard.press('ArrowRight');
      const trigger = page.locator(`button[data-menu-key="${keys[i]}"]`);
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }
  });
});
