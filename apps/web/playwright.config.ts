import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

process.loadEnvFile(fileURLToPath(new URL('../../.env.test.local', import.meta.url)));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Playwright E2E requires DATABASE_URL in .env.test.local.');
}
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? '4000';
const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? '3000';
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

const apiEnvironment = {
  API_PORT: apiPort,
  CSRF_HMAC_KEY: 'test-csrf-hmac-key-with-at-least-32-bytes',
  DATABASE_URL: databaseUrl,
  FILE_STORAGE_ROOT: '/tmp/rivet-playwright-files',
  NODE_ENV: 'test',
  ONE_TIME_TOKEN_HMAC_KEY: 'test-token-hmac-key-with-at-least-32-bytes',
  POSTHOG_API_KEY: '',
  RATE_LIMIT_HMAC_KEY: 'test-rate-hmac-key-with-at-least-32-bytes',
  RELEASE_ID: 'playwright-e2e',
  SLACK_ALERT_WEBHOOK_URL: '',
  WEB_ORIGIN: webOrigin,
};

const workerEnvironment = {
  DATABASE_URL: databaseUrl,
  FILE_STORAGE_ROOT: apiEnvironment.FILE_STORAGE_ROOT,
  NODE_ENV: 'test',
  ONE_TIME_TOKEN_HMAC_KEY: apiEnvironment.ONE_TIME_TOKEN_HMAC_KEY,
  POSTHOG_API_KEY: '',
  RATE_LIMIT_HMAC_KEY: apiEnvironment.RATE_LIMIT_HMAC_KEY,
  RELEASE_ID: apiEnvironment.RELEASE_ID,
  RESEND_ALLOWED_RECIPIENTS: 'playwright-mail-sink@example.test',
  RESEND_API_KEY: 'playwright-resend-disabled',
  RESEND_FROM: 'rivet-playwright@example.test',
  SLACK_ALERT_WEBHOOK_URL: '',
  WEB_ORIGIN: apiEnvironment.WEB_ORIGIN,
};

mkdirSync(apiEnvironment.FILE_STORAGE_ROOT, { recursive: true });
process.env.ONE_TIME_TOKEN_HMAC_KEY = apiEnvironment.ONE_TIME_TOKEN_HMAC_KEY;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  workers: 1,
  use: {
    baseURL: webOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'compact-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 640 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command:
        'pnpm --filter @rivet/database build && pnpm --filter @rivet/api build && pnpm --filter @rivet/api start',
      env: apiEnvironment,
      reuseExistingServer: false,
      timeout: 180_000,
      url: `${apiOrigin}/api/v1/health/live`,
    },
    {
      command: 'pnpm --filter @rivet/worker build && pnpm --filter @rivet/worker start',
      env: workerEnvironment,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      name: 'Worker',
      reuseExistingServer: false,
      timeout: 180_000,
      wait: { stdout: /Outbox polling 시작/u },
    },
    {
      command: 'pnpm build && pnpm start',
      env: {
        API_INTERNAL_ORIGIN: apiOrigin,
        PLAYWRIGHT_API_PROXY: 'true',
        RELEASE_ID: apiEnvironment.RELEASE_ID,
        WEB_PORT: webPort,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      url: `${webOrigin}/login`,
    },
  ],
});
