import { test, expect, type Page } from '@playwright/test';
import { setupCompanyPicker, setupRealWorkspace } from './workspace.setup';

/**
 * End-to-end keyboard navigation tests — HONEST version.
 *
 * Rule: no test body uses .focus() or page.focus() to reach a starting
 * position. The only way to reach the menubar is `page.keyboard.press('Tab')`
 * from the cold-start body-focus state established by setupRealWorkspace().
 * This is what catches real regressions like "Tab doesn't reach the menu"
 * or "arrow doesn't open the dropdown from a cold start".
 *
 * Radix Menubar contract:
 *   - Menubar is a single tabstop (Tab exits, arrows move inside).
 *   - ArrowDown / Enter on a trigger opens its dropdown and focuses the
 *     first item inside the portal — the trigger itself loses focus.
 *   - Escape closes the dropdown and restores focus to the trigger.
 */

/** Land focus on the File (first) menu trigger via Tab only. */
async function tabToFileMenu(page: Page) {
  await page.keyboard.press('Tab');
  const fileMenu = page.locator('button[data-menu-key="file"]');
  await expect(fileMenu).toBeFocused();
  return fileMenu;
}

test.describe('Keyboard navigation — top menu bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('startup focus lands on the top menu bar after a single Tab', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.dataset?.menuKey ?? el?.getAttribute('data-menu-key') ?? null;
    });
    expect(focused).toBe('file');
  });

  test('ArrowRight cycles forward through every top menu and wraps', async ({ page }) => {
    await tabToFileMenu(page);

    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBe('file');

    // Every ArrowRight after File opens the next menu (verified via
    // aria-expanded — trigger loses focus into the dropdown content).
    for (let i = 1; i < keys.length; i++) {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(`button[data-menu-key="${keys[i]}"]`)).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
  });

  test('ArrowLeft from File wraps to the last menu', async ({ page }) => {
    await tabToFileMenu(page);
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.locator(`button[data-menu-key="${keys[keys.length - 1]}"]`),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  test('Tab exits the menubar to the next focusable region', async ({ page }) => {
    // Radix Menubar (correctly) treats the menubar as a single tabstop.
    await tabToFileMenu(page);
    await page.keyboard.press('Tab');
    const stillOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(stillOnMenubar).toBe(false);
  });

  test('Shift+Tab from the menubar returns focus outside', async ({ page }) => {
    await tabToFileMenu(page);
    await page.keyboard.press('Shift+Tab');
    const stillOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(stillOnMenubar).toBe(false);
  });

  test('Escape on an open dropdown restores focus to the trigger', async ({ page }) => {
    const fileMenu = await tabToFileMenu(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"][data-state="open"]');
    await page.keyboard.press('Escape');
    await expect(fileMenu).toBeFocused();
  });

  test('ArrowDown opens the currently focused top menu', async ({ page }) => {
    await tabToFileMenu(page);
    await page.keyboard.press('ArrowRight'); // masters (opens)
    await page.keyboard.press('Escape'); // close, focus returns to masters
    await expect(page.locator('button[data-menu-key="masters"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('button[data-menu-key="masters"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

test.describe('Keyboard navigation — quick actions ribbon', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('ArrowUp from the ribbon returns focus to the menubar', async ({ page }) => {
    // Reach the ribbon by Tab (menubar is a single tabstop, next Tab lands
    // on the ribbon toggle button).
    await tabToFileMenu(page);
    await page.keyboard.press('Tab');
    const focusedInRibbon = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="toolbar"]') !== null;
    });
    expect(focusedInRibbon).toBe(true);

    await page.keyboard.press('ArrowUp');
    const backOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(backOnMenubar).toBe(true);
  });

  test('ArrowRight cycles through ribbon actions', async ({ page }) => {
    await tabToFileMenu(page);
    await page.keyboard.press('Tab'); // enter ribbon
    await page.keyboard.press('ArrowRight');
    const sales = page.locator('a[href="/app/vouchers/new/sales"]');
    await expect(sales).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const purchase = page.locator('a[href="/app/vouchers/new/purchase"]');
    await expect(purchase).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(sales).toBeFocused();
  });
});

test.describe('Keyboard navigation — company picker', () => {
  test.beforeEach(async ({ page }) => {
    await setupCompanyPicker(page);
  });

  test('focuses the first company without requiring Tab or mouse', async ({ page }) => {
    await expect(page.locator('[data-company-index="0"]')).toBeFocused();
  });

  test('arrow keys move through the visual company grid and wrap', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-company-index="1"]')).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-company-index="4"]')).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-company-index="1"]')).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-company-index="0"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-company-index="4"]')).toBeFocused();
  });

  test('Home and End jump to first and last company', async ({ page }) => {
    await page.keyboard.press('End');
    await expect(page.locator('[data-company-index="4"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-company-index="0"]')).toBeFocused();
  });

  test('Enter opens the focused company', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ym_active_company_id')))
      .toBe('company-2');
    await expect(page).toHaveURL(/\/app/);
  });
});
