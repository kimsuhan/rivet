import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

import { assertSafeTestDatabaseUrl } from '../src/test-database-url';

loadEnv({
  path: resolve(process.cwd(), '../../.env.test.local'),
  override: false,
  quiet: true,
});

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
