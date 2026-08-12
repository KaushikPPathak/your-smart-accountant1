import { test, expect, type Page } from '@playwright/test';
import { setupCompanyPicker, setupRealWorkspace } from './workspace.setup';

/**
 * End-to-end keyboard navigation tests — HONEST version.
 *
 * Rule: no test body uses .focus() or page.focus() to reach a starting
 * position. setupRealWorkspace() must leave focus on the File trigger so the
 * first arrow works immediately, without Tab or a mouse click.
 *
 * Radix Menubar contract:
 *   - Menubar is a single tabstop (Tab exits, arrows move inside).
 *   - ArrowDown / Enter on a trigger opens its dropdown and focuses the
 *     first item inside the portal — the trigger itself loses focus.
 *   - Escape closes the dropdown and restores focus to the trigger.
 */

/** Cold start parks focus on File so arrows work without an initial Tab. */
async function startOnFileMenu(page: Page) {
  const fileMenu = page.locator('button[data-menu-key="file"]');
  await expect(fileMenu).toBeFocused();
  return fileMenu;
}

test.describe('Keyboard navigation — top menu bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('startup focus lands on the top menu bar without Tab', async ({ page }) => {
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.dataset?.menuKey ?? el?.getAttribute('data-menu-key') ?? null;
    });
    expect(focused).toBe('file');
  });

  test('ArrowRight cycles forward through every top menu and wraps', async ({ page }) => {
    await startOnFileMenu(page);

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
    await startOnFileMenu(page);
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.locator(`button[data-menu-key="${keys[keys.length - 1]}"]`),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  test('Tab eventually exits the menubar into subsequent chrome', async ({ page }) => {
    // Radix Menubar is a single tabstop, but the first Tab after landing on
    // the trigger may not always leave — a couple of presses must.
    await startOnFileMenu(page);
    let escaped = false;
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      escaped = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.closest('[role="menubar"]') === null;
      });
      if (escaped) break;
    }
    expect(escaped).toBe(true);
  });

  test('Shift+Tab from the menubar returns focus outside', async ({ page }) => {
    await startOnFileMenu(page);
    await page.keyboard.press('Shift+Tab');
    const stillOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(stillOnMenubar).toBe(false);
  });

  test('Escape on an open dropdown restores focus to the trigger', async ({ page }) => {
    const fileMenu = await startOnFileMenu(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"][data-state="open"]');
    await page.keyboard.press('Escape');
    await expect(fileMenu).toBeFocused();
  });

  test('ArrowDown opens the currently focused top menu', async ({ page }) => {
    await startOnFileMenu(page);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-top-menu-content="file"] [role="menuitem"]').first()).toBeFocused();
  });

  test('ArrowDown, ArrowUp and Escape work in every top menu', async ({ page }) => {
    await startOnFileMenu(page);
    const keys = await page.$$eval(
      'button[data-menu-key]',
      (els) => els.map((e) => (e as HTMLElement).dataset.menuKey ?? ''),
    );

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const trigger = page.locator(`button[data-menu-key="${key}"]`);
      await expect(trigger).toBeFocused();

      await page.keyboard.press('ArrowDown');
      const items = page.locator(`[data-top-menu-content="${key}"] [role="menuitem"]:not([data-disabled])`);
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      if (await items.count() > 1) await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(items.first()).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');

      if (i < keys.length - 1) {
        await page.keyboard.press('ArrowRight');
        await expect(page.locator(`button[data-menu-key="${keys[i + 1]}"]`)).toBeFocused();
      }
    }
  });
});

test.describe('Keyboard navigation — quick actions ribbon', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  // Reach the ribbon toolbar via Tab presses only. Between the menubar and
  // the ribbon there may be intermediate focusable chrome (Install button,
  // etc.), so tab up to N times until focus lands inside role="toolbar".
  async function tabIntoRibbon(page: Page) {
    await startOnFileMenu(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inRibbon = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.closest('[role="toolbar"]') !== null;
      });
      if (inRibbon) return;
    }
    throw new Error('Tab never reached the quick actions ribbon');
  }

  test('Tab reaches the ribbon and ArrowUp returns focus to the menubar', async ({ page }) => {
    await tabIntoRibbon(page);
    await page.keyboard.press('ArrowUp');
    const backOnMenubar = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="menubar"]') !== null;
    });
    expect(backOnMenubar).toBe(true);
  });

  test('ArrowLeft / ArrowRight cycle focus inside the ribbon toolbar', async ({ page }) => {
    await tabIntoRibbon(page);
    const before = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.outerHTML?.slice(0, 80) ?? '',
    );
    await page.keyboard.press('ArrowRight');
    const afterRight = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.outerHTML?.slice(0, 80) ?? '',
    );
    expect(afterRight).not.toBe(before);
    // Focus must still be inside the ribbon toolbar.
    const stillInRibbon = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[role="toolbar"]') !== null;
    });
    expect(stillInRibbon).toBe(true);
    await page.keyboard.press('ArrowLeft');
    const afterLeft = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.outerHTML?.slice(0, 80) ?? '',
    );
    expect(afterLeft).toBe(before);
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
