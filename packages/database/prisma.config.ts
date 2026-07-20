import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

import { assertSafeTestDatabaseUrl } from './src/test-database-url';

const rootDirectory = resolve(process.cwd(), '../..');

if (process.env.NODE_ENV === 'test') {
  const testEnvironment = loadEnv({
    path: resolve(rootDirectory, '.env.test.local'),
    override: true,
    quiet: true,
  });

  if (testEnvironment.error || !testEnvironment.parsed?.DATABASE_URL) {
    throw new Error('테스트에는 루트 .env.test.local의 DATABASE_URL이 필요합니다.');
  }

  assertSafeTestDatabaseUrl(testEnvironment.parsed.DATABASE_URL);
} else {
  loadEnv({ path: resolve(rootDirectory, '.env.local'), quiet: true });
  loadEnv({ path: resolve(rootDirectory, '.env'), override: false, quiet: true });
}

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
  },
  schema: 'prisma',
});
