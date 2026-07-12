import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({
  path: resolve(process.cwd(), '../../.env.test.local'),
  override: true,
  quiet: true,
});

process.env.FILE_STORAGE_ROOT = mkdtempSync(join(tmpdir(), 'rivet-worker-test-'));
process.env.NODE_ENV = 'test';
process.env.ONE_TIME_TOKEN_HMAC_KEY = 'test-one-time-token-hmac-key-32-bytes';
process.env.POSTHOG_API_KEY = '';
process.env.RATE_LIMIT_HMAC_KEY = 'test-rate-limit-hmac-key-32-bytes!';
process.env.RELEASE_ID = 'worker-integration-test';
process.env.RESEND_ALLOWED_RECIPIENTS = 'allowed@example.test';
process.env.RESEND_API_KEY = 're_test_worker_dummy';
process.env.RESEND_FROM = 'rivet-worker@example.test';
process.env.SLACK_ALERT_WEBHOOK_URL = '';
process.env.WEB_ORIGIN = 'http://localhost:3000';
