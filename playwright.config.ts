import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Sandbox ships chromium build 1194 at this fixed path; the version
          // packaged with @playwright/test expects a newer build that isn't
          // available offline. Pointing at the installed binary avoids the
          // "run npx playwright install" trap.
          executablePath: '/chromium-1194/chrome-linux/chrome',
          args: ['--no-sandbox'],
        },
      },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
  },
});
