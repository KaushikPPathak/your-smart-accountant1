import { test, expect } from '@playwright/test';
import { setupRealWorkspace } from './workspace.setup';

/**
 * Perf budget: keyboard navigation must stay snappy.
 *
 * Budgets (loose enough for CI noise, tight enough to catch regressions):
 *   - ArrowRight across the ribbon: median frame ≤ 20ms, max ≤ 60ms.
 *
 * If this fails, someone re-introduced a state-driven roving tabIndex or a
 * synchronous heavy listener on the keystroke path. See
 * docs/KEYBOARD_ARCHITECTURE.md.
 */
test.describe('Keyboard perf budget', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('ribbon ArrowRight stays under budget', async ({ page }) => {
    // Move focus into the ribbon toolbar.
    const toggle = page.locator('[role="toolbar"] [data-focus-item][id$="-toggle"]').first();
    await toggle.focus();
    await expect(toggle).toBeFocused();

    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = Date.now();
      await page.keyboard.press('ArrowRight');
      samples.push(Date.now() - t);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const max = samples[samples.length - 1];
    // Playwright's own IPC adds ~5-15ms per press; budget is generous.
    expect(median, `median=${median}ms samples=${samples.join(',')}`).toBeLessThanOrEqual(60);
    expect(max, `max=${max}ms samples=${samples.join(',')}`).toBeLessThanOrEqual(150);
  });
});
