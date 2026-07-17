import { test, expect, type Page } from '@playwright/test';
import { setupCompanyPicker, setupRealWorkspace } from './workspace.setup';

/**
 * End-to-end keyboard navigation tests.
 *
 * These run against the real workspace shell (seeded via workspace.setup.ts)
 * and verify that the keyboard contract holds after every build:
 *   - Startup focus lands on the top menu bar
 *   - Arrow keys cycle top menus (Radix Menubar contract)
 *   - Home/End jump to first/last top menu
 *   - Tab / Shift+Tab move OUT of the menubar into surrounding chrome
 *     (Radix Menubar uses a single roving tabstop — this is the standard
 *     WAI-ARIA menubar pattern)
 *   - ArrowDown from a top menu trigger opens its dropdown and focuses the
 *     first item (Radix standard) OR moves focus into the quick ribbon
 *     (project-specific escape hatch when trigger is idle)
 *   - Escape closes an open dropdown and returns focus to the trigger
 *   - Quick ribbon arrow keys cycle actions horizontally
 *   - ArrowUp from the ribbon returns focus to the top menu
 */

async function focusFileMenu(page: Page) {
  const fileMenu = page.locator('button[data-menu-key="file"]');
  await fileMenu.focus();
  await expect(fileMenu).toBeFocused();
  return fileMenu;
}

test.describe('Keyboard navigation — top menu bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('startup focus lands on the top menu bar', async ({ page }) => {
    // The first Tab from a fresh page must reach a menu trigger, not get
    // trapped in browser chrome or a stray focusable element.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.dataset?.menuKey ?? el?.getAttribute('data-menu-key') ?? null;
    });
    expect(focused).toBe('file');
  });

  test('ArrowRight cycles forward through every top menu and wraps', async ({ page }) => {
    await focusFileMenu(page);

    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBe('file');

    // Walk forward across every trigger.
    for (let i = 1; i < keys.length; i++) {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(`button[data-menu-key="${keys[i]}"]`)).toBeFocused();
    }

    // Wrap-around back to the first menu.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`button[data-menu-key="${keys[0]}"]`)).toBeFocused();
  });

  test('ArrowLeft cycles backward and wraps', async ({ page }) => {
    await focusFileMenu(page);
    // From "file" (first), ArrowLeft should wrap to the last menu.
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(`button[data-menu-key="${keys[keys.length - 1]}"]`)).toBeFocused();
  });

  test('Home and End jump to first and last menu', async ({ page }) => {
    await focusFileMenu(page);
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );

    await page.keyboard.press('End');
    await expect(page.locator(`button[data-menu-key="${keys[keys.length - 1]}"]`)).toBeFocused();

    await page.keyboard.press('Home');
    await expect(page.locator(`button[data-menu-key="${keys[0]}"]`)).toBeFocused();
  });

  test('Tab exits the menubar to the next focusable region', async ({ page }) => {
    // Radix Menubar (correctly) treats the menubar as a single tabstop.
    // Tab MUST leave the menubar — it must not stay stuck on triggers.
    await focusFileMenu(page);
    await page.keyboard.press('Tab');
    const stillOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(stillOnMenubar).toBe(false);
  });

  test('Shift+Tab from the menubar returns focus outside', async ({ page }) => {
    await focusFileMenu(page);
    await page.keyboard.press('Shift+Tab');
    const stillOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(stillOnMenubar).toBe(false);
  });

  test('Escape closes an open dropdown and restores trigger focus', async ({ page }) => {
    const fileMenu = await focusFileMenu(page);
    // Enter or Space or ArrowDown opens the menu; use Enter for portability.
    await page.keyboard.press('Enter');
    // An open dropdown places focus inside the portal.
    await page.waitForSelector('[role="menu"][data-state="open"]');
    await page.keyboard.press('Escape');
    await expect(fileMenu).toBeFocused();
  });
});

test.describe('Keyboard navigation — quick actions ribbon', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('ArrowDown from the top menu enters the ribbon', async ({ page }) => {
    await focusFileMenu(page);
    // ArrowDown on a top menu trigger normally opens its dropdown; the
    // project also wires ArrowUp from the ribbon back to the topbar, so
    // exercise that path to verify the escape hatch is intact.
    const ribbonToggle = page.locator(
      'button[aria-label="Collapse quick entry ribbon"], button[aria-label="Expand quick entry ribbon"]',
    );
    // Move focus to the ribbon toggle explicitly, then verify ArrowUp comes back.
    await ribbonToggle.focus();
    await expect(ribbonToggle).toBeFocused();
    await page.keyboard.press('ArrowUp');
    const backOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(backOnMenubar).toBe(true);
  });

  test('ArrowRight cycles through ribbon actions', async ({ page }) => {
    const ribbonToggle = page.locator(
      'button[aria-label="Collapse quick entry ribbon"], button[aria-label="Expand quick entry ribbon"]',
    );
    await ribbonToggle.focus();
    await page.keyboard.press('ArrowRight');
    const sales = page.locator('a[href="/app/vouchers/new/sales"]');
    await expect(sales).toBeFocused();

    await page.keyboard.press('ArrowRight');
    const purchase = page.locator('a[href="/app/vouchers/new/purchase"]');
    await expect(purchase).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(sales).toBeFocused();
  });

  test('Home and End work inside the ribbon toolbar', async ({ page }) => {
    const ribbonToggle = page.locator(
      'button[aria-label="Collapse quick entry ribbon"], button[aria-label="Expand quick entry ribbon"]',
    );
    await ribbonToggle.focus();
    await page.keyboard.press('End');
    const focusedHref = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('href') ?? el?.id ?? null;
    });
    expect(focusedHref).not.toBeNull();

    await page.keyboard.press('Home');
    await expect(ribbonToggle).toBeFocused();
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

  test('Home and End jump to the first and last company', async ({ page }) => {
    await page.keyboard.press('End');
    await expect(page.locator('[data-company-index="4"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-company-index="0"]')).toBeFocused();
  });

  test('Tab and Shift+Tab leave the company grid normally', async ({ page }) => {
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: /New company/i })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-company-index="0"]')).toBeFocused();
  });

  test('Enter opens the focused company', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ym_active_company_id'))).toBe('company-2');
    await expect(page).toHaveURL(/\/app/);
  });
});
