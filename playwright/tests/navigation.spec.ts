import { test, expect } from '@playwright/test';
import { setupRealWorkspace } from './workspace.setup';

test.describe('Workspace Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupRealWorkspace(page);
  });

  test('startup focus should be on the File menu', async ({ page }) => {
    // The File menu (Your Mehtaji) has tabIndex 0 by default when focusedKey is 'file'
    const fileMenu = page.locator('button[data-menu-key="file"]');
    await page.keyboard.press('Tab');
    await expect(fileMenu).toBeFocused();
  });

  test('top-menu navigation with arrows and Tab', async ({ page }) => {
    const fileMenu = page.locator('button[data-menu-key="file"]');
    const mastersMenu = page.locator('button[data-menu-key="masters"]');
    
    await fileMenu.focus();
    
    // Test ArrowRight
    await page.keyboard.press('ArrowRight');
    await expect(mastersMenu).toBeFocused();
    
    // Test Tab
    await page.keyboard.press('Tab');
    const transactionsMenu = page.locator('button[data-menu-key="transactions"]');
    await expect(transactionsMenu).toBeFocused();
    
    // Test ArrowLeft
    await page.keyboard.press('ArrowLeft');
    await expect(mastersMenu).toBeFocused();
  });

  test('quick ribbon navigation via ArrowDown from top menu', async ({ page }) => {
    const fileMenu = page.locator('button[data-menu-key="file"]');
    const ribbonToggle = page.locator('button[aria-label="Collapse quick entry ribbon"], button[aria-label="Expand quick entry ribbon"]');
    
    await fileMenu.focus();
    
    // Pressing ArrowDown on a top menu trigger should move focus to the ribbon
    await page.keyboard.press('ArrowDown');
    await expect(ribbonToggle).toBeFocused();
    
    // Navigate inside ribbon
    await page.keyboard.press('ArrowRight');
    const salesItem = page.locator('a[href="/app/vouchers/new/sales"]');
    await expect(salesItem).toBeFocused();
  });
});
