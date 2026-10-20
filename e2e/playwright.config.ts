import { defineConfig } from '@playwright/test';

/**
 * Browser journeys across the admin portal (3200), the customer web app
 * (3100) and the API (4000) against the local database. Run the built apps
 * first, or let Playwright start them:
 *
 *   npm run build && npm run test:e2e
 *
 * Locally an installed Chrome is used (PW_CHANNEL=chrome); CI installs
 * Playwright's own Chromium.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run start:prod -w @corecheck/api',
      url: 'http://localhost:4000/health',
      cwd: '..',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npx next start -p 3100',
      url: 'http://localhost:3100/login',
      cwd: '../apps/web',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npx next start -p 3200',
      url: 'http://localhost:3200/login',
      cwd: '../apps/admin',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
