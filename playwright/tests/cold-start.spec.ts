import { test, expect } from '@playwright/test';
import { setupRealWorkspace } from './workspace.setup';

/**
 * Cold-start keyboard test — single owner verification.
 *
 * Setup uses the shared workspace helper (which primes local IndexedDB and
 * unlocks a test company). AFTER setup completes, we reload once so focus
 * resets cleanly to document.body — that reload is the "cold start" the user
 * described. From that point on, the test body uses ONLY keyboard input:
 *   - No page.focus()
 *   - No element.focus() / evaluate('.focus()')
 *   - Only page.keyboard.press()
 */

test.describe('Cold-start keyboard path (no programmatic focus in test body)', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
    // Fresh reload — focus resets to document.body, no residual focus from
    // the picker unlock step. This is the true cold-start state.
    await page.reload();
    await page.waitForSelector('nav[aria-label="Primary menus"]');
  });

  test('Tab → Right → Right → Enter reaches the Transactions dropdown', async ({ page }) => {
    // Single Tab must land on the File (brand) trigger.
    await page.keyboard.press('Tab');
    await expect(page.locator('button[data-menu-key="file"]')).toBeFocused();

    // ArrowRight → Masters focused AND its dropdown opens on focus alone.
    await page.keyboard.press('ArrowRight');
    const masters = page.locator('button[data-menu-key="masters"]');
    await expect(masters).toBeFocused();
    await expect(masters).toHaveAttribute('aria-expanded', 'true');

    // ArrowRight → Transactions focused AND its dropdown open (no Enter yet).
    await page.keyboard.press('ArrowRight');
    const transactions = page.locator('button[data-menu-key="transactions"]');
    await expect(transactions).toBeFocused();
    await expect(transactions).toHaveAttribute('aria-expanded', 'true');

    // Transactions dropdown must be visible with real items.
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();

    // Enter on an already-open trigger is a no-op — menu stays visible.
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: /All Vouchers/i }),
    ).toBeVisible();
  });

  test('arrow alone (no Enter) opens every top menu in sequence', async ({ page }) => {
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
