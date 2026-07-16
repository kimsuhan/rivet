import { createECDH } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({
  path: resolve(process.cwd(), '../../.env.test.local'),
  override: true,
  quiet: true,
});

process.env.API_PORT = '4000';
process.env.CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
process.env.FILE_STORAGE_ROOT = mkdtempSync(join(tmpdir(), 'rivet-api-test-'));
process.env.NODE_ENV = 'test';
process.env.ONE_TIME_TOKEN_HMAC_KEY = 'test-token-hmac-key-with-at-least-32-bytes';
process.env.POSTHOG_API_KEY = '';
process.env.RATE_LIMIT_HMAC_KEY = 'test-rate-hmac-key-with-at-least-32-bytes';
process.env.RELEASE_ID = 'api-integration-test';
process.env.SLACK_ALERT_WEBHOOK_URL = '';
process.env.WEB_ORIGIN = 'http://localhost:3000';
const webPushKeys = createECDH('prime256v1');
webPushKeys.generateKeys();
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = webPushKeys.getPublicKey().toString('base64url');
