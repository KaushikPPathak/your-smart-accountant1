import { test as setup, type Page } from '@playwright/test';

export async function setupRealWorkspace(page: Page) {
  await page.goto('/');
  
  await page.evaluate(async () => {
    // 1. Setup localStorage for Auth & Active Company
    localStorage.setItem('sb-supabase-auth-token', JSON.stringify({
      access_token: 'fake-token',
      refresh_token: 'fake-refresh',
      user: { id: 'test-user', email: 'test@example.com' },
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }));
    
    const companyId = 'test-company-123';
    localStorage.setItem('ym_active_company_id', companyId);
    localStorage.setItem('ym_quickribbon_open', '1');

    // 2. Seed IndexedDB using Dexie (available on window if we import it or wait for app)
    // Since we are in the browser, we can use the native IndexedDB API directly 
    // or wait for the app's bundle to load the offlineDb.
    // For a robust setup, we use the native API to seed the cache tables.
    const request = indexedDB.open('ym_offline_cache_v3', 8);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache_companies')) {
        db.createObjectStore('cache_companies', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('companies')) {
        db.createObjectStore('companies', { keyPath: 'id' });
      }
    };
    
    await new Promise((resolve, reject) => {
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction(['cache_companies', 'companies'], 'readwrite');
        tx.objectStore('cache_companies').put({
          id: companyId,
          name: 'Test Business Corp',
          gst_registered: true,
          financial_year_start: '2024-04-01',
          mode: 'normal'
        });
        tx.objectStore('companies').put({
          id: companyId,
          name: 'Test Business Corp'
        });
        tx.oncomplete = resolve;
        tx.onerror = reject;
      };
    });
  });

  await page.reload();
  // Wait for the dashboard to be visible
  await page.waitForSelector('nav[aria-label="Primary menus"]');
}
